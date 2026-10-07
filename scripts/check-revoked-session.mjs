#!/usr/bin/env node
/** Fixture-only proof after process/container recreation. Never prints cookies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = process.env.BASE ?? 'http://127.0.0.1:3997';
const proof = JSON.parse(readFileSync(process.env.REVOCATION_PROOF, 'utf8'));
async function invitation(cookie) {
  return fetch(base + '/api/guest-links', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'fixture', ttlHours: 1 }) });
}
assert.equal((await invitation(proof.revokedCookie)).status, 401, 'same revoked cookie revived after recreation/return');
assert.equal((await invitation(proof.otherCookie)).status, process.env.STATE_UNAVAILABLE === '1' ? 401 : 200, 'unaffected account did not obey store availability');
const guestPath = new URL(proof.guestUrl, base).pathname;
const guest = await fetch(base + guestPath, { redirect: 'manual' });
assert.ok(guest.status >= 300 && guest.status < 400, 'existing guest invitation failed');
assert.ok(guest.headers.getSetCookie().some(value => value.startsWith('signdrop_guest=')), 'existing invitation no longer signs guest access');
assert.equal((await fetch(base + '/verify')).status, 200, 'public verification failed');
console.log('Revoked cookie remains 401; account availability, existing guest link and public verification pass after recreation/compatible configuration return or store fault.');
