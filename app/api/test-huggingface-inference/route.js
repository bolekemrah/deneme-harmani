import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const token = process.env.HUGGINGFACE_API_KEY;
  if (!token) return NextResponse.json({ ok: false, error: 'HUGGINGFACE_API_KEY bulunamadı.' }, { status: 500 });

  const model = 'Qwen/Qwen2.5-7B-Instruct';
  const endpoint = 'https://router.huggingface.co/hf-inference/models/' + model + '/v1/chat/completions';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Sadece TAMAM yaz.' }],
        max_tokens: 8,
        temperature: 0,
      }),
      cache: 'no-store',
    });

    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok) {
      console.error('HF inference smoke test failed:', response.status, raw.slice(0, 1500));
      return NextResponse.json({
        ok: false,
        provider: 'huggingface',
        model,
        status: response.status,
        error: data?.error?.message || data?.error || raw.slice(0, 500) || `HTTP ${response.status}`,
      }, { status: 502 });
    }

    const output = data?.choices?.[0]?.message?.content || null;
    return NextResponse.json({ ok: true, provider: 'huggingface', model, output, message: 'Hugging Face inference isteği başarıyla çalıştı.' });
  } catch (error) {
    console.error('HF inference smoke test error:', error);
    return NextResponse.json({ ok: false, provider: 'huggingface', model, error: 'Hugging Face inference sunucusuna bağlanılamadı.' }, { status: 502 });
  }
}
