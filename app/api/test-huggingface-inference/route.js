import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const token = process.env.HUGGINGFACE_API_KEY;
  if (!token) return NextResponse.json({ ok: false, error: 'HUGGINGFACE_API_KEY bulunamadı.' }, { status: 500 });

  try {
    const modelsResponse = await fetch('https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-generation&sort=trendingScore&direction=-1&limit=30', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const modelsRaw = await modelsResponse.text();
    let models = [];
    try { models = JSON.parse(modelsRaw); } catch {}
    if (!modelsResponse.ok || !Array.isArray(models)) {
      return NextResponse.json({ ok: false, stage: 'model-discovery', status: modelsResponse.status, error: modelsRaw.slice(0, 700) }, { status: 502 });
    }

    const candidates = models.map((m) => m?.id).filter(Boolean).slice(0, 12);
    const attempts = [];

    for (const model of candidates) {
      const endpoint = 'https://router.huggingface.co/hf-inference/models/' + model + '/v1/chat/completions';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Sadece TAMAM yaz.' }], max_tokens: 8, temperature: 0 }),
        cache: 'no-store',
      });
      const raw = await response.text();
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      attempts.push({ model, status: response.status, error: response.ok ? null : (data?.error?.message || data?.error || raw.slice(0, 180)) });
      if (response.ok) {
        return NextResponse.json({ ok: true, provider: 'huggingface', model, output: data?.choices?.[0]?.message?.content || null, message: 'Hugging Face inference isteği başarıyla çalıştı.', attempts });
      }
    }

    return NextResponse.json({ ok: false, provider: 'huggingface', stage: 'inference', error: 'Listelenen hf-inference modellerinden hiçbiri test isteğini kabul etmedi.', candidates, attempts }, { status: 502 });
  } catch (error) {
    console.error('HF inference discovery test error:', error);
    return NextResponse.json({ ok: false, provider: 'huggingface', error: 'Hugging Face inference testi sırasında bağlantı hatası oluştu.' }, { status: 502 });
  }
}
