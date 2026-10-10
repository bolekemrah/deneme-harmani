import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeExamText } from '../../../lib/pdf-analysis';
import { validateQuestionCandidate, createQualityRecord } from '../../../lib/question-quality';

export const runtime = 'nodejs';
export const maxDuration = 60;

function pageItemsToText(items = []) {
  const positioned = items.filter((item) => item && typeof item.str === 'string' && item.str.trim()).map((item) => ({ str: item.str.trim(), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) })).sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);
  const lines = [];
  for (const item of positioned) { let line = lines.find((entry) => Math.abs(entry.y - item.y) <= 2.5); if (!line) { line = { y: item.y, parts: [] }; lines.push(line); } line.parts.push(item); }
  return lines.sort((a, b) => b.y - a.y).map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ')).join('\n');
}

async function extractPdfText(pdfBytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: Uint8Array.from(pdfBytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = []; let pagesWithText = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); const pageText = pageItemsToText(content.items); if (pageText.replace(/\s/g, '').length >= 20) pagesWithText += 1; pages.push(pageText); }
  const text = pages.join('\n\n');
  return { text, pages: document.numPages, pagesWithText, needsOcr: text.replace(/\s/g, '').length < 100 || pagesWithText < Math.max(1, Math.ceil(document.numPages * 0.2)) };
}

function parseJson(text) { const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim(); try { return JSON.parse(cleaned); } catch { return null; } }
const ANALYSIS_PROMPT = `Bu PDF bir sınav/deneme kaynağı olabilir veya ilgisiz bir belge olabilir. Belgenin içeriğini gerçekten incele. Sadece A, B, C, D, E harfleri veya numaralı maddeler bulunduğu için soru kabul etme. Her gerçek çoktan seçmeli soruyu ayrı ayrı tespit et. Soru kökü ile seçeneklerin aynı soruya ait olduğunu doğrula. Başlıkları, içindekileri, rapor maddelerini, açıklama listelerini ve cevap anahtarı satırlarını soru sayma. Eksik veya şüpheli adayları uydurma. Türkçe metni mümkün olduğunca aynen koru. Ders ve konu için emin değilsen null kullan. Doğru cevabı tahmin etme. Yalnızca geçerli JSON döndür: {"documentIsExam":true,"documentConfidence":0,"questions":[{"number":1,"stem":"...","options":[{"label":"A","text":"..."}],"subject":null,"topic":null,"questionConfidence":0}],"notes":[]}`;

async function findGeminiModel(apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) { const body = await response.text(); console.error('Gemini model list failed:', response.status, body.slice(0, 1500)); return { error: `Gemini model listesi alınamadı (${response.status}).` }; }
  const data = await response.json(); const usable = (data.models || []).filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'));
  const preferred = usable.find((model) => /gemini-3\.8-flash/i.test(model.name)) || usable.find((model) => /gemini-3/i.test(model.name) && /flash/i.test(model.name) && !/image|tts|live/i.test(model.name)) || usable.find((model) => /flash/i.test(model.name) && !/2\.5-flash/i.test(model.name) && !/image|tts|live/i.test(model.name)) || usable.find((model) => /gemini/i.test(model.name) && !/2\.5-flash/i.test(model.name) && !/image|tts|live/i.test(model.name));
  if (!preferred?.name) return { error: 'Bu API anahtarı için güncel Gemini generateContent modeli bulunamadı.' };
  return { modelResource: preferred.name, model: preferred.name.replace(/^models\//, '') };
}

async function analyzePdfWithGemini(pdfBytes) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) return { error: 'GEMINI_API_KEY sunucuda tanımlı değil.', code: 'AI_NOT_CONFIGURED' };
  const selected = await findGeminiModel(apiKey); if (selected.error) return { ...selected, code: 'AI_MODEL_UNAVAILABLE' };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${selected.modelResource}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: Buffer.from(pdfBytes).toString('base64') } }, { text: ANALYSIS_PROMPT }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }) });
  if (!response.ok) { const responseBody = await response.text(); console.error('Gemini PDF analysis failed:', response.status, responseBody.slice(0, 3000)); let friendly = `Yapay zekâ analiz servisi isteği reddetti (HTTP ${response.status}).`; if (response.status === 403) friendly = 'Gemini projesinin API erişimi Google tarafından reddedildi. PDF için yapay zekâ analizi gerçekleştirilemedi.'; if (response.status === 429) friendly = 'Gemini ücretsiz kullanım kotası veya hız limiti aşıldı. PDF için yapay zekâ analizi gerçekleştirilemedi.'; return { error: friendly, code: 'AI_PROVIDER_ERROR', providerStatus: response.status }; }
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || ''; const parsed = parseJson(text);
  if (!parsed) return { error: 'Gemini yanıtı güvenilir biçimde okunamadı.', code: 'AI_INVALID_RESPONSE' };
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((question) => { const validation = validateQuestionCandidate(question); return { ...question, validation, quality: createQualityRecord(question, validation) }; });
  const verifiedQuestions = questions.filter((q) => q.validation.isQuestion && Number(q.questionConfidence || 0) >= 70);
  return { provider: 'gemini', model: selected.model, documentIsExam: Boolean(parsed.documentIsExam), documentConfidence: Number(parsed.documentConfidence || 0), questions, verifiedQuestions, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''; const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''; if (!token) return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    const body = await request.json(); const path = String(body?.path || ''); const fileName = String(body?.fileName || path.split('/').pop() || 'dosya.pdf'); if (!path) return NextResponse.json({ error: 'Analiz edilecek PDF yolu eksik.' }, { status: 400 });
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Sunucu depolama ayarları eksik.' }, { status: 500 });
    const supabase = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token); if (userError || !userData?.user) return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 }); if (!path.startsWith(`${userData.user.id}/`)) return NextResponse.json({ error: 'Bu PDF için erişim iznin yok.' }, { status: 403 });
    const { data: pdfBlob, error: downloadError } = await supabase.storage.from('pdfs').download(path); if (downloadError || !pdfBlob) return NextResponse.json({ error: 'PDF bulut alanından indirilemedi.' }, { status: 500 });
    const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer()); const parsed = await extractPdfText(pdfBytes); const textResult = analyzeExamText(parsed.text);
    if (textResult.questionCount < 3 || textResult.confidence < 60) {
      const ai = await analyzePdfWithGemini(pdfBytes);
      if (ai.error) return NextResponse.json({ error: ai.error, code: ai.code, providerStatus: ai.providerStatus || null, analysisStatus: 'failed', fileName, pages: parsed.pages, pagesWithText: parsed.pagesWithText, textLength: parsed.text.length, needsOcr: parsed.needsOcr, localQuestionCount: textResult.questionCount, localConfidence: textResult.confidence }, { status: 503 });
      const count = ai.verifiedQuestions.length;
      return NextResponse.json({ analysisStatus: 'completed', fileName, pages: parsed.pages, pagesWithText: parsed.pagesWithText, textLength: parsed.text.length, needsOcr: parsed.needsOcr, analysisMode: 'gemini-pdf', aiUsed: true, aiProvider: 'gemini', aiModel: ai.model, suitable: ai.documentIsExam && count > 0, confidence: ai.documentConfidence, questionCount: count, candidateCount: ai.questions.length, choiceCount: ai.verifiedQuestions.reduce((sum, q) => sum + (q.options?.length || 0), 0), answerKeyDetected: false, questions: ai.verifiedQuestions, rejectedQuestions: ai.questions.filter((q) => !ai.verifiedQuestions.includes(q)), reasons: count ? ai.notes : ['Gemini belgeyi inceledi ancak yeterli güvenle gerçek sınav sorusu doğrulayamadı.', ...ai.notes] });
    }
    return NextResponse.json({ analysisStatus: 'completed', fileName, pages: parsed.pages, pagesWithText: parsed.pagesWithText, textLength: parsed.text.length, needsOcr: parsed.needsOcr, analysisMode: 'pdf-text', ...textResult });
  } catch (error) { console.error('PDF analysis failed:', error); return NextResponse.json({ error: 'PDF okunurken veya analiz edilirken bir sorun oluştu.', analysisStatus: 'failed' }, { status: 500 }); }
}
