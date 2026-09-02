import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_TSA_URL = 'https://freetsa.org/tsr';

export async function POST(request: NextRequest) {
  try {
    const tsaUrl = process.env.SIGNDROP_TSA_URL || DEFAULT_TSA_URL;
    const body = await request.arrayBuffer();

    // Guard: ensure payload is small (RFC 3161 queries are typically < 500 bytes)
    if (body.byteLength === 0 || body.byteLength > 4096) {
      return NextResponse.json({ error: 'Invalid TimeStampReq payload length' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const tsaRes = await fetch(tsaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
      },
      body: body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!tsaRes.ok) {
      return NextResponse.json({ error: `TSA returned ${tsaRes.status}` }, { status: tsaRes.status });
    }

    const resBytes = await tsaRes.arrayBuffer();
    return new NextResponse(resBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/timestamp-reply',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('Error forwarding to TSA:', err);
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'TSA server timed out' : 'Failed to reach TSA server' },
      { status: 504 }
    );
  }
}
