import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';
import { getSession } from '@/lib/auth/session';
import { currentGuest } from '@/lib/auth/guest';

/**
 * The only request this product makes to a third party, and the only thing it
 * sends: a 32-byte hash.
 *
 * An RFC 3161 time-stamp is a signed statement that a value existed at a
 * moment. The value here is the hash of the PDF signature, not of the
 * document — the time-stamping authority learns nothing about what was signed,
 * how long it was, or who signed it. It has to be a server route rather than a
 * call from the page, because no TSA sends CORS headers.
 *
 * What this route is careful about:
 *
 * - **Where it forwards to** comes only from the environment. It is never
 *   read from the request, so there is nothing here to point at an internal
 *   address.
 * - **Plain HTTP is allowed, deliberately, and only here.** The trusted lists
 *   are refused over HTTP because nothing else authenticates them; a
 *   time-stamp token authenticates itself. It is signed by the TSA, and
 *   SignDrop's verifier checks both that the signature verifies and that the
 *   token's imprint is the hash of this signature — so an attacker on the
 *   wire can withhold a token or corrupt one, and cannot forge or replay one.
 *   Which matters because the free time-stamping services that Acrobat
 *   accepts, DigiCert's among them, publish no HTTPS endpoint.
 * - **It is not an open proxy.** A signed-in caller gets an allowance of
 *   their own; a guest spends the allowance of whoever invited them, which is
 *   what makes handing out an invitation a decision with a cost attached; and
 *   anyone else gets a small one per IP. Without that, the deployment's quota
 *   at somebody else's TSA is there for the taking.
 * - **Nothing about the body is logged**, on the way in or out. The hash is
 *   not interesting, but a log that grows a line per signature is a record of
 *   who signed and when, and this service does not keep records.
 */

/**
 * DigiCert: free, RFC 3161, and accepted by Acrobat. It is NOT on the EU
 * trusted list, and /verify says so rather than letting a reader assume a
 * qualified time-stamp. A qualified one needs a listed provider and a
 * contract; when there is one, this variable is where it goes.
 */
const DEFAULT_TSA_URL = 'http://timestamp.digicert.com';

/** Per hour. Enough for a working day of signing, not enough to resell. */
const ANONYMOUS_STAMPS = 20;
const SIGNED_IN_STAMPS = 200;
const WINDOW_MS = 60 * 60 * 1000;

/** RFC 3161 queries are a few hundred bytes; 4 KB is already generous. */
const MAX_REQUEST_BYTES = 4096;
/** A token with the TSA's whole chain is a few kilobytes. */
const MAX_REPLY_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;

function tsaUrl(): URL | null {
  const raw = process.env.SIGNDROP_TSA_URL?.trim() || DEFAULT_TSA_URL;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const url = tsaUrl();
  if (!url) {
    return NextResponse.json({ error: 'No time-stamping authority is configured.' }, { status: 503 });
  }

  const [session, guest] = await Promise.all([getSession(), currentGuest()]);
  // A guest is accounted to the person who invited them: an invitation is a
  // share of your own allowance, not a new one.
  const key = session ? `tsa:user:${session.sub}` : guest ? `tsa:user:${guest.by}` : `tsa:ip:${clientIp(request)}`;
  const limit = rateLimit(key, session || guest ? SIGNED_IN_STAMPS : ANONYMOUS_STAMPS, WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'That is not a TimeStampReq.' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const reply = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!reply.ok) {
      return NextResponse.json({ error: `The time-stamping authority answered ${reply.status}.` }, { status: 502 });
    }

    // A reply that is not a time-stamp reply is something else entirely — a
    // captive portal, an error page, a proxy notice — and handing it to the
    // signer would embed it in the signature as if it were a token.
    const type = reply.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type && type !== 'application/timestamp-reply') {
      return NextResponse.json({ error: 'The time-stamping authority did not answer with a time-stamp.' }, { status: 502 });
    }

    const bytes = await reply.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPLY_BYTES) {
      return NextResponse.json({ error: 'The time-stamping authority answered with an implausible token.' }, { status: 502 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/timestamp-reply', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    // Deliberately says nothing about the body, and nothing about which
    // authority: the first is the caller's business and the second is the
    // deployment's.
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      { error: timedOut ? 'The time-stamping authority timed out.' : 'The time-stamping authority could not be reached.' },
      { status: 504 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
