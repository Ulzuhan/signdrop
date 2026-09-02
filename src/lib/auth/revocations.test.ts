import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRevocations, revoke, revokedAfter } from './revocations';

/**
 * The list that makes a stateless session revocable.
 *
 * Its whole job is a comparison of two instants, and getting the direction
 * wrong either lets a revoked person keep working or throws everybody out.
 * Both are silent.
 */
beforeEach(() => forgetRevocations());
afterEach(() => vi.useRealTimers());

describe('revoking', () => {
  it('says nothing about somebody who was never revoked', () => {
    expect(revokedAfter('nobody', Date.now())).toBe(false);
  });

  it('invalidates a cookie issued before the mark', () => {
    const issued = Date.now() - 5000;
    revoke('sub-1');
    expect(revokedAfter('sub-1', issued)).toBe(true);
  });

  it('leaves a cookie issued after the mark alone: signing in again works', () => {
    revoke('sub-1');
    expect(revokedAfter('sub-1', Date.now() + 1000)).toBe(false);
  });

  it('touches nobody else', () => {
    revoke('sub-1');
    expect(revokedAfter('sub-2', Date.now() - 5000)).toBe(false);
  });

  it('forgets a mark old enough that the cookie it referred to has expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
    const issued = Date.now() - 1000;
    revoke('sub-1');
    expect(revokedAfter('sub-1', issued)).toBe(true);

    // Twenty-six hours later the mark cannot prevent anything: the cookie it
    // referred to would have expired on its own hours ago, and keeping it
    // would only grow the map for the life of the process.
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    expect(revokedAfter('sub-1', issued)).toBe(false);
  });
});
