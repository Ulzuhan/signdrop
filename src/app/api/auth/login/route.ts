import { NextRequest, NextResponse } from 'next/server';
import { authorizeUrl, challengeFor, newVerifier, oidcConfig, safeNext } from '@/lib/auth/oidc';
import { HANDSHAKE_COOKIE, handshakeCookieOptions } from '@/lib/auth/session';

/**
 * GET /api/auth/login — starts signing in.
 *
 * The PKCE verifier, the anti-CSRF state and where to return to are kept in a
 * short-lived cookie. A cookie rather than server state because there is no
 * session yet: this happens before we know who is asking.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'Sign-in is not configured on this instance' }, { status: 503 });
  }

  const verifier = newVerifier();
  const state = newVerifier();

  // Internal paths only: without this, a link carrying ?next=https://elsewhere
  // would turn signing in into a redirector to wherever an attacker wanted.
  const next = safeNext(request.nextUrl.searchParams.get('next'));

  const response = NextResponse.redirect(await authorizeUrl(cfg, { state, codeChallenge: challengeFor(verifier) }));
  response.cookies.set(HANDSHAKE_COOKIE, JSON.stringify({ verifier, state, next }), handshakeCookieOptions);
  return response;
}
