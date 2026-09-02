import { NextRequest, NextResponse } from 'next/server';
import {
  getOidcConfig,
  generatePkce,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  fetchDiscoveryEndpoints,
} from '@/lib/auth/oidc';
import { setSession, clearSession, savePkceState, getAndClearPkceState, getSession } from '@/lib/auth/session';

export async function GET(request: NextRequest, { params }: { params: Promise<{ oidc: string[] }> }) {
  const { oidc } = await params;
  const action = oidc[0];
  const config = getOidcConfig();

  if (action === 'me') {
    const session = await getSession();
    return NextResponse.json({ user: session });
  }

  if (!config) {
    return NextResponse.json({ error: 'OIDC is not configured on this instance' }, { status: 404 });
  }

  if (action === 'login') {
    const { verifier, challenge, state } = generatePkce();
    await savePkceState(state, verifier);
    const authUrl = await buildAuthorizationUrl(config, state, challenge);
    return NextResponse.redirect(authUrl);
  }

  if (action === 'callback') {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const pkce = await getAndClearPkceState();
    if (!pkce || !code || pkce.state !== state) {
      return NextResponse.redirect(new URL('/?error=invalid_auth_state', request.url));
    }

    try {
      const tokens = await exchangeCodeForTokens(config, code, pkce.verifier);
      const user = await fetchUserInfo(config, tokens.access_token);
      await setSession(user);
      return NextResponse.redirect(new URL('/', request.url));
    } catch (err) {
      console.error('Authentication callback error:', err);
      return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
    }
  }

  if (action === 'logout') {
    await clearSession();
    try {
      const endpoints = await fetchDiscoveryEndpoints(config.discoveryUrl);
      if (endpoints.end_session_endpoint) {
        const logoutUrl = new URL(endpoints.end_session_endpoint);
        logoutUrl.searchParams.set('post_logout_redirect_uri', new URL('/', request.url).toString());
        return NextResponse.redirect(logoutUrl.toString());
      }
    } catch {
      // Fallback if discovery fails
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}
