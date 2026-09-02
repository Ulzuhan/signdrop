import { NextRequest, NextResponse } from 'next/server';

/**
 * The content policy, with a nonce per request.
 *
 * There was none at all. `next.config.ts` set the sensible headers around it —
 * frame options, nosniff, referrer, HSTS — and then let any script in the
 * document run. For a tool that opens a stranger's PDF in the page and holds
 * a private key in memory while it does, that is the wrong end to be lax at.
 *
 * Next gets a fresh nonce on every request and puts it on its own inline
 * scripts; `'strict-dynamic'` lets those load theirs. An injected `<script>`
 * carries no nonce and does not run. The nonce is generated here, per
 * request, rather than baked at build time — there is no way to build without
 * the environment and end up with a policy that quietly allows everything.
 *
 * The directives that are specific to what this application does:
 *
 *   worker-src 'self' blob:   pdf.js parses the document in a worker, and
 *                             bundlers hand workers to the page as a blob.
 *                             It is `'self'` and not a CDN because the worker
 *                             is now served from this origin (see
 *                             src/lib/pdf/engine.ts) — the whole point.
 *   img-src … blob:           the rendered pages and the signature canvas.
 *   connect-src 'self'        nothing here talks to a third party. The
 *                             time-stamping authority is reached by the
 *                             server, from /api/tsa, never by the page.
 *   font-src 'self'           the four calligraphic faces are self-hosted by
 *                             next/font; they used to come from Google.
 *
 * `style-src` still allows inline styles, and it is the one thing here that
 * is not as tight as it should be. SignDrop's own eighty-one inline styles
 * are gone — they are classes in signdrop-workspace.css now, and a test keeps
 * them gone. What is left is the shared KaiCorp chrome (`kaicorp-*.tsx`),
 * which is generated: it is copied from the kaicorplabs repository by
 * sync-theme.sh and shared with five deployed services, so tightening it is
 * a change to all six and not to this one. Written down rather than quietly
 * lived with.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  /**
   * `upgrade-insecure-requests`, but only where there is something to upgrade
   * TO.
   *
   * Chromium exempts loopback from this directive. WebKit does not: served
   * over plain http on 127.0.0.1 it rewrote every stylesheet, font and script
   * chunk to `https://127.0.0.1`, every one of them died in a TLS handshake,
   * and the page came up with no styles, no pdf.js and no way to read a
   * document. Found by the Safari project in CI, which is what it was added
   * for.
   *
   * It is not only a testing problem: anybody self-hosting this behind a
   * plain-http reverse proxy on a LAN would serve a broken page to every
   * Safari user, and would have no idea why.
   *
   * The scheme comes from the proxy header first, because behind the tunnel
   * the container itself speaks http. That header is written by the caller
   * when there is no proxy in front, and that is fine here: this directive is
   * defence in depth for the person receiving the response, so forcing it on
   * or off only ever affects the browser that asked.
   */
  const secure =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' || request.nextUrl.protocol === 'https:';

  /**
   * The identity provider's origin, from the environment and never written
   * here: this repository is public and the hostname belongs to a deployment.
   * Only `form-action` needs it — the browser is redirected there by a
   * navigation, not by a fetch.
   */
  const idp = (() => {
    const base = process.env.SIGNDROP_OIDC_ISSUER?.trim();
    if (!base) return [];
    try {
      return [new URL(base).origin];
    } catch {
      return [];
    }
  })();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    ['form-action', "'self'", ...idp].join(' '),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|bcmap|pfb|json|mjs)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
