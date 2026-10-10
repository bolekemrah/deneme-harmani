import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeExamText } from '../../../lib/pdf-analysis';
import { validateQuestionCandidate, createQualityRecord } from '../../../lib/question-quality';

export const runtime = 'nodejs';
export const maxDuration = 60;

function pageItemsToText(items = []) {
  const positioned = items
    .filter((item) => item && typeof item.str === 'string' && item.str.trim())
    .map((item) => ({ str: item.str.trim(), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);
  const lines = [];
  for (const item of positioned) {
    let line = lines.find((entry) => Math.abs(entry.y - item.y) <= 2.5);
    if (!line) { line = { y: item.y, parts: [] }; lines.push(line); }
    line.parts.push(item);
  }
  return lines.sort((a, b) => b.y - a.y)
    .map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ')).join('\n');
}

async function extractPdfText(pdfBytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  // pdf.js aktarilan typed array'in ArrayBuffer'ini detach edebilir. Bu nedenle
  // yalnızca metin çıkarımı için bağımsız bir kopya veriyoruz.
  const pdfjsBytes = Uint8Array.from(pdfBytes);
  const document = await pdfjs.getDocument({ data: pdfjsBytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  let pagesWithText = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = pageItemsToText(content.items);
    if (pageText.replace(/\s/g, '').length >= 20) pagesWithText += 1;
    pages.push(pageText);
  }
  const text = pages.join('\n\n');
  return { text, pages: document.numPages, pagesWithText, needsOcr: text.replace(/\s/g, '').length < 100 || pagesWithText < Math.max(1, Math.ceil(document.numPages * 0.2)) };
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data?.output || []) for (const content of item?.content || []) if (typeof content?.text === 'string') parts.push(content.text);
  return parts.join('\n');
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function analyzePdfWithAI(pdfBytes, fileName) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: 'OPENAI_API_KEY sunucuda tanımlı değil.' };
  const base64 = Buffer.from(pdfBytes).toString('base64');
  const prompt = `Bu PDF bir sınav/deneme kaynağı olabilir veya ilgisiz bir belge olabilir. Belgeyi gerçekten incele. Sadece A-B-C-D-E harfleri gördüğün için soru kabul etme. Her gerçek çoktan seçmeli soruyu ayrı ayrı belirle. Soru kökü ile ona ait seçeneklerin aynı soruya ait olduğundan emin ol. Başlık, içindekiler, rapor maddeleri, cevap anahtarı satırları ve rastgele numaralı listeleri soru sayma. Emin olmadığın adayı soru olarak uydurma. Türkçe metni aynen korumaya çalış. Yalnızca JSON döndür: {"documentIsExam":boolean,"documentConfidence":0-100,"questions":[{"number":number|null,"stem":string,"options":[{"label":"A","text":string}],"subject":string|null,"topic":string|null,"questionConfidence":0-100}],"notes":[string]}. Doğru cevabı tahmin etme.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-mini', input: [{ role: 'user', content: [
      { type: 'input_file', filename: fileName, file_data: `data:application/pdf;base64,${base64}` },
      { type: 'input_text', text: prompt }
    ] }], text: { format: { type: 'json_object' } } })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error('OpenAI PDF analysis failed:', response.status, body.slice(0, 1000));
    return { error: `AI analizi başarısız oldu (${response.status}).` };
  }
  const data = await response.json();
  const parsed = parseJson(extractResponseText(data));
  if (!parsed) return { error: 'AI yanıtı yapılandırılmış olarak okunamadı.' };
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((question) => {
    const validation = validateQuestionCandidate(question);
    return { ...question, validation, quality: createQualityRecord(question, validation) };
  });
  const verifiedQuestions = questions.filter((q) => q.validation.isQuestion && Number(q.questionConfidence || 0) >= 70);
  return { aiUsed: true, documentIsExam: Boolean(parsed.documentIsExam), documentConfidence: Number(parsed.documentConfidence || 0), questions, verifiedQuestions, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    const body = await request.json();
    const path = String(body?.path || '');
    const fileName = String(body?.fileName || path.split('/').pop() || 'dosya.pdf');
    if (!path) return NextResponse.json({ error: 'Analiz edilecek PDF yolu eksik.' }, { status: 400 });
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Sunucu depolama ayarları eksik.' }, { status: 500 });
    const supabase = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    if (!path.startsWith(`${userData.user.id}/`)) return NextResponse.json({ error: 'Bu PDF için erişim iznin yok.' }, { status: 403 });
    const { data: pdfBlob, error: downloadError } = await supabase.storage.from('pdfs').download(path);
    if (downloadError || !pdfBlob) return NextResponse.json({ error: 'PDF bulut alanından indirilemedi.' }, { status: 500 });

    // Ana PDF baytlarını Buffer olarak sakla. pdf.js yalnızca kendi kopyasını kullanır;
    // böylece AI fallback aynı PDF'yi daha sonra güvenle okuyabilir.
    const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
    const parsed = await extractPdfText(pdfBytes);
    const textResult = analyzeExamText(parsed.text);

    if (textResult.questionCount < 3 || textResult.confidence < 60) {
      const ai = await analyzePdfWithAI(pdfBytes, fileName);
      if (!ai.error) {
        const count = ai.verifiedQuestions.length;
        return NextResponse.json({
          fileName, pages: parsed.pages, pagesWithText: parsed.pagesWithText, textLength: parsed.text.length,
          needsOcr: parsed.needsOcr, analysisMode: 'ai-pdf', aiUsed: true,
          suitable: ai.documentIsExam && count > 0, confidence: ai.documentConfidence,
          questionCount: count, candidateCount: ai.questions.length,
          choiceCount: ai.verifiedQuestions.reduce((sum, q) => sum + (q.options?.length || 0), 0),
          answerKeyDetected: false, questions: ai.verifiedQuestions,
          rejectedQuestions: ai.questions.filter((q) => !ai.verifiedQuestions.includes(q)),
          reasons: count ? ai.notes : ['AI belgeyi inceledi ancak yeterli güvenle gerçek sınav sorusu doğrulayamadı.', ...ai.notes]
        });
      }
      console.error('AI fallback unavailable:', ai.error);
    }
    return NextResponse.json({ fileName, pages: parsed.pages, pagesWithText: parsed.pagesWithText, textLength: parsed.text.length, needsOcr: parsed.needsOcr, analysisMode: 'pdf-text', ...textResult });
  } catch (error) {
    console.error('PDF analysis failed:', error);
    return NextResponse.json({ error: 'PDF okunurken veya analiz edilirken bir sorun oluştu.' }, { status: 500 });
  }
}
