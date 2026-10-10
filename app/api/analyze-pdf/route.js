import { NextResponse } from 'next/server';
import { analyzeExamText } from '../../../lib/pdf-analysis';

export const runtime = 'nodejs';

async function extractPdfText(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
  }).promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
  }

  return {
    text: pages.join('\n'),
    pages: document.numPages,
  };
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Analiz için bir PDF dosyası gerekli.' }, { status: 400 });
    }

    const isPdf = file.type === 'application/pdf' || String(file.name || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return NextResponse.json({ error: 'Yalnızca PDF dosyaları analiz edilebilir.' }, { status: 400 });
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF şu anda en fazla 25 MB olabilir.' }, { status: 413 });
    }

    const parsed = await extractPdfText(await file.arrayBuffer());
    const result = analyzeExamText(parsed.text);

    return NextResponse.json({
      fileName: file.name,
      pages: parsed.pages,
      textLength: parsed.text.length,
      ...result,
    });
  } catch (error) {
    console.error('PDF analysis failed:', error);
    return NextResponse.json({ error: 'PDF okunurken veya analiz edilirken bir sorun oluştu.' }, { status: 500 });
  }
}
