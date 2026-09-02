import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clampTtlHours, mintGuestToken, readGuestToken, DEFAULT_TTL_HOURS, MAX_TTL_HOURS, MIN_TTL_HOURS } from './guest';

/**
 * The invitation, which is the only credential in this service that is handed
 * to somebody who has no account.
 *
 * There is nothing on the server to check it against, so everything it is
 * worth rests on the HMAC and on what the payload says. Which makes these the
 * assertions that matter: a forged token is refused, an expired one is
 * refused, and a session cookie is not an invitation even though both are a
 * signed base64url blob under the same key.
 */
const SECRET = 'un-secreto-de-pruebas-de-treinta-y-dos-bytes';

beforeEach(() => {
  process.env.SIGNDROP_SESSION_SECRET = SECRET;
});

describe('minting', () => {
  it('round-trips who invited, whom for, and until when', () => {
    const token = mintGuestToken({ by: 'sub-123', label: 'the other party', ttlHours: 3 })!;
    const link = readGuestToken(token)!;
    expect(link.by).toBe('sub-123');
    expect(link.label).toBe('the other party');
    expect(link.exp * 1000).toBeGreaterThan(Date.now());
    expect(link.exp * 1000).toBeLessThanOrEqual(Date.now() + 3 * 3600_000 + 1000);
  });

  it('refuses to mint without a secret rather than minting something worthless', () => {
    delete process.env.SIGNDROP_SESSION_SECRET;
    expect(mintGuestToken({ by: 'sub-123' })).toBeNull();
  });

  it('cuts a label that is long enough to be a payload', () => {
    const token = mintGuestToken({ by: 'sub', label: 'x'.repeat(500) })!;
    expect(readGuestToken(token)!.label!.length).toBe(80);
  });
});

describe('how long it lasts', () => {
  it('defaults, floors and caps', () => {
    expect(clampTtlHours(undefined)).toBe(DEFAULT_TTL_HOURS);
    expect(clampTtlHours('not a number')).toBe(DEFAULT_TTL_HOURS);
    expect(clampTtlHours(0)).toBe(MIN_TTL_HOURS);
    expect(clampTtlHours(-40)).toBe(MIN_TTL_HOURS);
    expect(clampTtlHours(99999)).toBe(MAX_TTL_HOURS);
    expect(clampTtlHours(2.9)).toBe(2);
  });

  it('an expired token is not a token', () => {
    const token = mintGuestToken({ by: 'sub' })!;
    const [payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.exp = Math.floor(Date.now() / 1000) - 1;
    // Re-signed properly, so only the expiry is wrong: this is the attacker
    // who holds an old link, not one who cannot sign.
    const rebuilt = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(`guest.${rebuilt}`).digest('base64url');
    expect(readGuestToken(`${rebuilt}.${signature}`)).toBeNull();
  });
});

describe('what it refuses', () => {
  it('a token signed with another key', () => {
    const token = mintGuestToken({ by: 'sub' })!;
    process.env.SIGNDROP_SESSION_SECRET = 'otro-secreto-igual-de-largo-de-32-bytes';
    expect(readGuestToken(token)).toBeNull();
  });

  it('a payload edited after signing', () => {
    const token = mintGuestToken({ by: 'sub' })!;
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.exp += 86400 * 365;
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(readGuestToken(`${forged}.${signature}`)).toBeNull();
  });

  it('nonsense, in every shape', () => {
    expect(readGuestToken(undefined)).toBeNull();
    expect(readGuestToken('')).toBeNull();
    expect(readGuestToken('no-dots')).toBeNull();
    expect(readGuestToken('.only-a-signature')).toBeNull();
    expect(readGuestToken('not-base64url.also-not')).toBeNull();
  });

  it('a payload that signs cleanly but says nothing useful', () => {
    // Correctly signed and still not a link: `by` and `exp` are what a link is.
    const empty = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(`guest.${empty}`).digest('base64url');
    expect(readGuestToken(`${empty}.${signature}`)).toBeNull();
  });
});

describe('domain separation, which is the one that would be silent', () => {
  it('a session cookie is not an invitation', () => {
    // Exactly how a session cookie is sealed: same key, no `guest.` prefix.
    const payload = Buffer.from(
      JSON.stringify({ sub: 'sub', email: 'a@b.c', iat: Date.now(), exp: Date.now() + 3600_000 })
    ).toString('base64url');
    const asSession = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
    expect(readGuestToken(asSession)).toBeNull();
  });
});
