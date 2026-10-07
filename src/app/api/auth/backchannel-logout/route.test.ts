import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeRevocations } from '../../../../../scripts/revocation-store.js';
import { revokedAfter } from '@/lib/auth/revocations';
vi.mock('@/lib/auth/oidc', () => ({ oidcConfig: () => ({ clientId: 'fixture' }) }));
vi.mock('@/lib/auth/backchannel', () => ({ verificarCierre: vi.fn(async () => ({ sub: 'subject', jti: 'fixture-notice' })) }));
import { POST } from './route';

let directory: string;
let database: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'signdrop-logout-'));
  database = join(directory, 'revocations.sqlite');
  vi.stubEnv('SIGNDROP_REVOCATION_DB', database);
  initializeRevocations();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
function request() {
  return new Request('https://fixture.example.invalid/api/auth/backchannel-logout', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'logout_token=verified-fixture',
  });
}
it('returns 503 on storage loss; the same verified notice remains retryable after recovery', async () => {
  renameSync(database, database + '.held');
  expect((await POST(request())).status).toBe(503);
  renameSync(database + '.held', database);
  expect((await POST(request())).status).toBe(200);
  expect(revokedAfter('subject', Date.now() - 1)).toBe(true);
  expect((await POST(request())).status).toBe(400);
});
