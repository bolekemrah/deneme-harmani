import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const token = process.env.HUGGINGFACE_API_KEY;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'HUGGINGFACE_API_KEY Vercel ortamında bulunamadı.' }, { status: 500 });
  }

  try {
    const response = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok) {
      console.error('Hugging Face connection test failed:', response.status, raw.slice(0, 1000));
      return NextResponse.json({
        ok: false,
        status: response.status,
        error: response.status === 401 || response.status === 403
          ? 'Hugging Face tokeni reddedildi veya gerekli yetkiye sahip değil.'
          : `Hugging Face bağlantı testi başarısız oldu (HTTP ${response.status}).`,
      }, { status: 502 });
    }

    console.log('Hugging Face connection test succeeded.');
    return NextResponse.json({
      ok: true,
      provider: 'huggingface',
      authenticated: true,
      accountType: data?.type || null,
      message: 'Hugging Face API bağlantısı çalışıyor.',
    });
  } catch (error) {
    console.error('Hugging Face connection test error:', error);
    return NextResponse.json({ ok: false, error: 'Hugging Face sunucusuna bağlanılamadı.' }, { status: 502 });
  }
}
