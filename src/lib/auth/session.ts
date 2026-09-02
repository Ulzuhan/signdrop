/**
 * Session and cookie management for SignDrop.
 */
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import { UserSession } from './oidc';

const COOKIE_NAME = 'signdrop_session';
const PKCE_COOKIE_NAME = 'signdrop_pkce';

function getSecretKey(): string {
  return process.env.SIGNDROP_SESSION_SECRET || 'signdrop-insecure-dev-secret-change-in-prod-000000000000';
}

function sign(payload: string): string {
  const secret = getSecretKey();
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verify(signed: string): string | null {
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expectedSig = createHmac('sha256', getSecretKey()).update(payload).digest('base64url');
  
  if (signature.length !== expectedSig.length) return null;
  const isValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  return isValid ? payload : null;
}

export async function setSession(user: UserSession) {
  const cookieStore = await cookies();
  const payload = Buffer.from(JSON.stringify(user)).toString('base64url');
  const signed = sign(payload);

  cookieStore.set(COOKIE_NAME, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const payload = verify(raw);
  if (!payload) return null;

  try {
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(json) as UserSession;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function savePkceState(state: string, verifier: string) {
  const cookieStore = await cookies();
  const payload = JSON.stringify({ state, verifier });
  const signed = sign(Buffer.from(payload).toString('base64url'));

  cookieStore.set(PKCE_COOKIE_NAME, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });
}

export async function getAndClearPkceState(): Promise<{ state: string; verifier: string } | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PKCE_COOKIE_NAME)?.value;
  if (!raw) return null;

  cookieStore.delete(PKCE_COOKIE_NAME);
  const payload = verify(raw);
  if (!payload) return null;

  try {
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
