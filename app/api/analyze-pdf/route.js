import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeExamText } from '../../../lib/pdf-analysis';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
  }

  return { text: pages.join('\n'), pages: document.numPages };
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    }

    const body = await request.json();
    const path = String(body?.path || '');
    const fileName = String(body?.fileName || path.split('/').pop() || 'dosya.pdf');
    if (!path) {
      return NextResponse.json({ error: 'Analiz edilecek PDF yolu eksik.' }, { status: 400 });
    }

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
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    }

    if (!path.startsWith(`${userData.user.id}/`)) {
      return NextResponse.json({ error: 'Bu PDF için erişim iznin yok.' }, { status: 403 });
    }

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
      textLength: parsed.text.length,
      ...result,
    });
  } catch (error) {
    console.error('PDF analysis failed:', error);
    return NextResponse.json({ error: 'PDF okunurken veya analiz edilirken bir sorun oluştu.' }, { status: 500 });
  }
}
