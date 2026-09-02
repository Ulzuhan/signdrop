/**
 * OIDC client conforming to KaiCorp Rule R (Discovery URL based, IdP agnostic).
 * Zero runtime dependencies.
 */
import { createHash, randomBytes } from 'crypto';

export interface OidcConfig {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface UserSession {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  picture?: string;
}

let cachedEndpoints: {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
} | null = null;

export function getOidcConfig(): OidcConfig | null {
  const clientId = process.env.SIGNDROP_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.SIGNDROP_OIDC_CLIENT_SECRET?.trim();
  const discoveryUrl = process.env.SIGNDROP_OIDC_DISCOVERY_URL?.trim();
  const redirectUri = process.env.SIGNDROP_OIDC_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !discoveryUrl || !redirectUri) {
    return null;
  }

  return { discoveryUrl, clientId, clientSecret, redirectUri };
}

export function isOidcEnabled(): boolean {
  return getOidcConfig() !== null;
}

export async function fetchDiscoveryEndpoints(discoveryUrl: string) {
  if (cachedEndpoints) return cachedEndpoints;

  const res = await fetch(discoveryUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch OIDC discovery document: ${res.status}`);
  }
  const data = await res.json();
  cachedEndpoints = {
    authorization_endpoint: data.authorization_endpoint,
    token_endpoint: data.token_endpoint,
    userinfo_endpoint: data.userinfo_endpoint,
    end_session_endpoint: data.end_session_endpoint,
  };
  return cachedEndpoints;
}

export function generatePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  return { verifier, challenge, state };
}

export async function buildAuthorizationUrl(config: OidcConfig, state: string, codeChallenge: string): Promise<string> {
  const endpoints = await fetchDiscoveryEndpoints(config.discoveryUrl);
  const url = new URL(endpoints.authorization_endpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCodeForTokens(config: OidcConfig, code: string, codeVerifier: string): Promise<{ access_token: string; id_token?: string }> {
  const endpoints = await fetchDiscoveryEndpoints(config.discoveryUrl);
  
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${errorText}`);
  }

  return res.json();
}

export async function fetchUserInfo(config: OidcConfig, accessToken: string): Promise<UserSession> {
  const endpoints = await fetchDiscoveryEndpoints(config.discoveryUrl);
  const res = await fetch(endpoints.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch userinfo: ${res.status}`);
  }

  return res.json();
}
