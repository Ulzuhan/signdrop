import { NextResponse } from 'next/server';
import { verificarCierre } from '@/lib/auth/backchannel';
import { oidcConfig } from '@/lib/auth/oidc';
import { revoke } from '@/lib/auth/revocations';

/**
 * Where the provider says one of its sessions has ended.
 *
 * Called by the PROVIDER, server to server — never by a browser — so there
 * are no cookies here, no CSRF and no origin to check: the only thing that
 * authenticates this request is the signature on the `logout_token`, and
 * that is what verificarCierre does.
 *
 * The session here is a sealed cookie and does not live on the server, so
 * there is nothing to delete: the subject goes on the revocation list and
 * from that instant their cookies stop counting. The list is in memory —
 * SignDrop keeps no volume — which is written up in ./revocations.ts.
 *
 * The status codes are the ones the specification expects: 200 when handled,
 * 400 when the token is no good. Never 401 or 403, which would make the
 * provider retry forever something that is never going to improve.
 */

/**
 * A logout token is a few hundred bytes; 16 KiB is generous.
 *
 * This endpoint is public and unauthenticated — it has to be, the provider
 * calls it — and `request.text()` swallows whatever it is sent. App Router
 * brings no body limit of its own, so without this an enormous body piles up
 * in memory. The container has a memory cap and would at worst restart, but a
 * restart anybody can trigger from outside is a lever not worth handing over.
 *
 * The header is checked AND the bytes are counted: `Content-Length` is
 * written by the caller, and the caller can lie.
 */
const BODY_LIMIT = 16 * 1024;

async function boundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return null;

  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > BODY_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: Request): Promise<NextResponse> {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.json({ error: 'not_configured' }, { status: 404 });

  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/x-www-form-urlencoded')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 400 });
  }

  const body = await boundedBody(request);
  if (body === null) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });

  let token: string | null = null;
  try {
    token = new URLSearchParams(body).get('logout_token');
  } catch {
    token = null;
  }
  if (!token) return NextResponse.json({ error: 'missing logout_token' }, { status: 400 });

  let notice;
  try {
    notice = await verificarCierre(token, cfg);
  } catch {
    // The provider could not be reached to check the signature: that is our
    // failure and does deserve a retry.
    return NextResponse.json({ error: 'verification unavailable' }, { status: 503 });
  }
  if (!notice) return NextResponse.json({ error: 'invalid logout_token' }, { status: 400 });

  // The cookie names the person by the provider's own `sub`, so that is what
  // the list is kept by — no lookup needed to check it when reading a cookie.
  if (notice.sub) revoke(notice.sub);

  return NextResponse.json({ ok: true });
}
