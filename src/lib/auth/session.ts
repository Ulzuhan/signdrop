/**
 * The session: a sealed cookie, with durable revocation marks.
 *
 * Access model, after the decision recorded in docs/34 of the infrastructure
 * repository:
 *
 *   PUBLIC      /verify. Checking a signature needs no account and never
 *               will: the whole product falls over if the person who receives
 *               a signed contract has to register to read it.
 *   GUEST       a signed link the workspace hands out. Whoever holds it can
 *               sign, and only sign, until it expires. See ./guest.ts.
 *   SIGNED IN   the workspace. Who may have an account is decided in the
 *               provider, which only issues tokens for people in this
 *               application's group.
 *
 * The cookie carries the identity itself. Only revocation marks are stored
 * server-side, in the private durable auth volume; no accounts or documents.
 * Removal at the provider still requires its back-channel notice or expiry.
 *
 * Changing SIGNDROP_SESSION_SECRET still revokes every session at once.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { oidcConfigured, type OidcIdentity } from './oidc';
import { revokedAfter, revocationsReady } from './revocations';

export const SESSION_COOKIE = 'signdrop_session';

const configuredTtl = Number(process.env.SIGNDROP_SESSION_TTL_HOURS ?? process.env.SIGNDROP_SESSION_HOURS ?? 12);
const SESSION_TTL_HOURS = Number.isFinite(configuredTtl) ? Math.min(24, Math.max(1, configuredTtl)) : 12;
const SESSION_TTL_MS = Math.floor(SESSION_TTL_HOURS * 60 * 60 * 1000);

/**
 * The signing secret, or null.
 *
 * There is no development fallback and no generated-at-startup value: a
 * secret that changes on every restart looks like it works and silently logs
 * everybody out, and one written into the source is not a secret. Without it
 * the service refuses to start in production — see scripts/start.js.
 */
export function sessionSecret(): string | null {
  const secret = process.env.SIGNDROP_SESSION_SECRET?.trim();
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

/** Whether this instance can authenticate anybody at all. */
export function isConfigured(): boolean {
  return Boolean(sessionSecret() && oidcConfigured() && revocationsReady());
}

export interface UserSession {
  sub: string;
  email: string;
  name?: string;
  /** When the cookie was issued. What makes revocation possible without storing sessions. */
  iat: number;
}

// ─── Cookie sealing ─────────────────────────────────────────────────
function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(identity: OidcIdentity): string | null {
  const secret = sessionSecret();
  if (!secret || !revocationsReady()) return null;
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ sub: identity.sub, email: identity.email, name: identity.name, iat: now, exp: now + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The identity inside a cookie, or null if it is forged, stale or revoked. */
export function sessionFromToken(token: string | undefined): UserSession | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!Number.isSafeInteger(claims.exp) || claims.exp <= Date.now()) return null;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
    // Never infer iat using the current TTL: a configuration return could
    // move that instant. First initialization already cuts pre-store cookies.
    const iat = claims.iat;
    if (!Number.isSafeInteger(iat) || iat > Date.now() || claims.exp <= iat || claims.exp - iat > 24 * 3600_000) return null;
    if (revokedAfter(claims.sub, iat)) return null;
    return { sub: claims.sub, email: claims.email, name: typeof claims.name === 'string' ? claims.name : undefined, iat };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  // Behind the tunnel everything is HTTPS; relaxed in local development so
  // signing in still works over http on localhost.
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

// ─── Used from routes and pages ─────────────────────────────────────

/** The person behind this request, or null. */
export async function getSession(): Promise<UserSession | null> {
  const store = await cookies();
  return sessionFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function hasSession(): Promise<boolean> {
  return (await getSession()) !== null;
}

/** Null if the request may proceed, or the 401 to send back. */
export async function requireSession(): Promise<Response | null> {
  if (await hasSession()) return null;
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function startSession(identity: OidcIdentity): Promise<void> {
  const token = createSessionToken(identity);
  if (!token) throw new Error('SIGNDROP_SESSION_SECRET is not set');
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// ─── The sign-in handshake ──────────────────────────────────────────
// Kept here rather than in a cookie of its own per route: it is the same
// short-lived state, and two places to spell it is two places to get the
// flags wrong.

export const HANDSHAKE_COOKIE = 'signdrop_oidc';

export const handshakeCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // "strict" would not survive the trip back from the provider: the browser
  // treats it as a cross-site navigation and would withhold the cookie.
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 10 * 60,
};
