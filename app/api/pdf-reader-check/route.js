import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    stage: 'pdf-reader-check',
    message: 'PDF reader route is ready for parser integration.',
  });
}
