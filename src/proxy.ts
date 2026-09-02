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
    'upgrade-insecure-requests',
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
