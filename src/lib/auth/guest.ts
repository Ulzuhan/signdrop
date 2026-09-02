/**
 * Guest links: signing without an account, without the server remembering
 * anything.
 *
 * The product falls over if the other party has to register. You send someone
 * a contract; they have to be able to open it, sign it with their own
 * certificate and send it back, and nothing about that is improved by making
 * them ask you for an account first. So whoever does have one can mint a link
 * that unlocks the workspace for a while.
 *
 * DocDrop solves the same problem with a JSON file per link (see its
 * src/lib/guest.ts): a token, a counter, a revoke button. It can, because a
 * guest there UPLOADS something and DocDrop has a volume to put it in. Here
 * there is nothing to upload — the link unlocks a tool that runs entirely in
 * the guest's own browser, and the server never sees the document — so the
 * token carries its own contents and the server checks them with the session
 * secret. SignDrop stays the one service of the eight with no volume, no
 * backup and no `borrar-persona`.
 *
 * The price, and it is deliberate: **a single link cannot be revoked**. It
 * expires (24 hours by default, 7 days at most) or every link is revoked at
 * once by rotating SIGNDROP_SESSION_SECRET — which also ends every session,
 * so it is not a small lever. That is acceptable because of what is behind
 * the link: not documents, which the server never holds, but quota at the
 * time-stamping proxy.
 *
 * The token is `payload.signature`, the payload naming who issued it, an
 * optional label, and when it stops working. It is only ever read by this
 * server, so the encoding is ours to choose and JSON is the honest one.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { sessionSecret } from './session';

export const GUEST_COOKIE = 'signdrop_guest';
/** Where the link puts the guest, and what the workspace looks for. */
export const GUEST_PARAM = 'invite';

export const MIN_TTL_HOURS = 1;
export const DEFAULT_TTL_HOURS = 24;
export const MAX_TTL_HOURS = 7 * 24;

export interface GuestLink {
  /** The `sub` of whoever minted it. Informational: it is who to ask about it. */
  by: string;
  /** Whom it was made for, as the issuer wrote it. Never shown to anyone else. */
  label?: string;
  /** Seconds since the epoch. */
  exp: number;
}

export function clampTtlHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TTL_HOURS;
  return Math.min(Math.max(Math.floor(n), MIN_TTL_HOURS), MAX_TTL_HOURS);
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`guest.${payload}`).digest('base64url');
}

/**
 * A token, or null when this instance has no secret to sign one with.
 *
 * The `guest.` prefix inside the HMAC is domain separation: without it a
 * session cookie and a guest token are two base64url payloads signed with the
 * same key, and anything that got one accepted where the other belongs would
 * be a hole. They are different kinds of claim and they are signed as such.
 */
export function mintGuestToken(input: { by: string; label?: string; ttlHours?: unknown }): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const link: GuestLink = {
    by: input.by,
    ...(input.label ? { label: input.label.slice(0, 80) } : {}),
    exp: Math.floor(Date.now() / 1000) + clampTtlHours(input.ttlHours) * 3600,
  };
  const payload = Buffer.from(JSON.stringify(link)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The link a token stands for, or null if it is forged, malformed or expired. */
export function readGuestToken(token: string | undefined | null): GuestLink | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const link = JSON.parse(Buffer.from(payload, 'base64url').toString()) as GuestLink;
    if (typeof link.by !== 'string' || typeof link.exp !== 'number') return null;
    if (link.exp * 1000 <= Date.now()) return null;
    return link;
  } catch {
    return null;
  }
}

export const guestCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_TTL_HOURS * 3600,
};

/** The guest link behind this request, from the cookie the invite page set. */
export async function currentGuest(): Promise<GuestLink | null> {
  const store = await cookies();
  return readGuestToken(store.get(GUEST_COOKIE)?.value);
}
