import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeExamText } from '../../../lib/pdf-analysis';

export const runtime = 'nodejs';
export const maxDuration = 60;

function pageItemsToText(items = []) {
  const positioned = items
    .filter((item) => item && typeof item.str === 'string' && item.str.trim())
    .map((item) => ({
      str: item.str.trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
    }))
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2.5) return b.y - a.y;
      return a.x - b.x;
    });

  const lines = [];
  for (const item of positioned) {
    let line = lines.find((entry) => Math.abs(entry.y - item.y) <= 2.5);
    if (!line) {
      line = { y: item.y, parts: [] };
      lines.push(line);
    }
    line.parts.push(item);
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(' '))
    .join('\n');
}

async function extractPdfText(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const document = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

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
  return {
    text,
    pages: document.numPages,
    pagesWithText,
    needsOcr: text.replace(/\s/g, '').length < 100 || pagesWithText < Math.max(1, Math.ceil(document.numPages * 0.2)),
  };
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
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase environment variables are missing.');
      return NextResponse.json({ error: 'Sunucu depolama ayarları eksik.' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    if (!path.startsWith(`${userData.user.id}/`)) return NextResponse.json({ error: 'Bu PDF için erişim iznin yok.' }, { status: 403 });

    const { data: pdfBlob, error: downloadError } = await supabase.storage.from('pdfs').download(path);
    if (downloadError || !pdfBlob) {
      console.error('Supabase PDF download failed:', downloadError);
      return NextResponse.json({ error: 'PDF bulut alanından indirilemedi.' }, { status: 500 });
    }

    const parsed = await extractPdfText(await pdfBlob.arrayBuffer());
    const result = analyzeExamText(parsed.text);

    return NextResponse.json({
      fileName,
      pages: parsed.pages,
      pagesWithText: parsed.pagesWithText,
      textLength: parsed.text.length,
      needsOcr: parsed.needsOcr,
      ...result,
      reasons: parsed.needsOcr && result.questionCount === 0
        ? ['PDF metin katmanı yetersiz görünüyor; görüntü/OCR analizi gerekiyor.', ...(result.reasons || [])]
        : result.reasons,
    });
  } catch (error) {
    console.error('PDF analysis failed:', error);
    return NextResponse.json({ error: 'PDF okunurken veya analiz edilirken bir sorun oluştu.' }, { status: 500 });
  }
}
