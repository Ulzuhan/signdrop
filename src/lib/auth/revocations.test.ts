import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeRevocations } from '../../../scripts/revocation-store.js';
import { revoke, revokedAfter, revocationsReady } from './revocations';
import { createSessionToken, sessionFromToken } from './session';
import { mintGuestToken, readGuestToken } from './guest';

const SECRET = 'fixture-revocations-secret-at-least-32-bytes';
const exec = promisify(execFile);
const STORE = resolve('scripts/revocation-store.js');
let directory: string;
let database: string;
let cutoff: number;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'signdrop-revocations-'));
  database = join(directory, 'revocations.sqlite');
  vi.stubEnv('SIGNDROP_REVOCATION_DB', database);
  vi.stubEnv('SIGNDROP_SESSION_SECRET', SECRET);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  cutoff = Date.now();
  initializeRevocations();
  vi.setSystemTime(cutoff + 1000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function cookie(extra: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: 'subject', email: 'fixture@example.invalid', iat: Date.now(), exp: Date.now() + 3600_000, ...extra })).toString('base64url');
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}
function child(source: string) {
  return execFileSync(process.execPath, ['-e', `Date.now=()=>${Date.now()}; const store=require(${JSON.stringify(STORE)}); ${source}`], { encoding: 'utf8', env: process.env }).trim();
}

describe('durable session boundary', () => {
  it('accepts a legitimate cookie, denies it after revoke and in a fresh process', () => {
    const token = createSessionToken({ sub: 'subject', email: 'fixture@example.invalid' })!;
    expect(sessionFromToken(token)?.sub).toBe('subject');
    revoke('subject', 'notice');
    expect(sessionFromToken(token)).toBeNull();
    expect(child(`console.log(store.revokedAfter('subject', ${Date.now()}))`)).toBe('true');
    expect(child("console.log(store.revoke('subject', 'notice'))")).toBe('false');
  });
  it('keeps other subjects and a later login working', () => {
    const other = cookie({ sub: 'other' });
    revoke('subject');
    expect(sessionFromToken(other)?.sub).toBe('other');
    vi.setSystemTime(Date.now() + 1);
    expect(sessionFromToken(createSessionToken({ sub: 'subject', email: 'fixture@example.invalid' })!)?.sub).toBe('subject');
  });
  it('cuts pre-initialization cookies without changing guest signatures', () => {
    expect(sessionFromToken(cookie({ iat: cutoff }))).toBeNull();
    vi.setSystemTime(cutoff - 1000);
    const guest = mintGuestToken({ by: 'subject' })!;
    vi.setSystemTime(cutoff + 1000);
    expect(readGuestToken(guest)?.by).toBe('subject');
    revoke('subject');
    expect(readGuestToken(guest)?.by).toBe('subject');
  });
  it('rejects inferred/invalid issue times across TTL changes and forged cookies', () => {
    vi.stubEnv('SIGNDROP_SESSION_TTL_HOURS', '24');
    for (const extra of [{ iat: undefined }, { iat: null }, { iat: Date.now() + 1 }, { iat: Date.now(), exp: Date.now() + 25 * 3600_000 }, { exp: Date.now() - 1 }]) {
      expect(sessionFromToken(cookie(extra))).toBeNull();
    }
    expect(sessionFromToken(cookie() + 'x')).toBeNull();
  });
  it('never forgets a mark through retention or a backward clock', () => {
    revoke('subject');
    const issued = Date.now();
    vi.setSystemTime(issued + 26 * 3600_000);
    expect(revokedAfter('subject', issued)).toBe(true);
    revoke('subject');
    vi.setSystemTime(issued + 1);
    revoke('subject');
    expect(revokedAfter('subject', issued + 1000)).toBe(true);
  });
  it('does not recreate missing state and retries the same notice after recovery', () => {
    const token = cookie();
    renameSync(database, database + '.held');
    expect(sessionFromToken(token)).toBeNull();
    expect(revocationsReady()).toBe(false);
    expect(() => revoke('subject', 'retry')).toThrow();
    renameSync(database + '.held', database);
    expect(revoke('subject', 'retry')).toBe(true);
    expect(sessionFromToken(token)).toBeNull();
  });
  it('rejects corrupt, empty and unsupported state; never clears it', () => {
    const token = cookie();
    const original = readFileSync(database);
    for (const bytes of [Buffer.from('not SQLite'), Buffer.alloc(0)]) {
      writeFileSync(database, bytes);
      expect(sessionFromToken(token)).toBeNull();
      expect(revocationsReady()).toBe(false);
      expect(() => initializeRevocations()).toThrow();
      expect(readFileSync(database)).toEqual(bytes);
    }
    writeFileSync(database, original);
    const db = new DatabaseSync(database);
    db.exec('PRAGMA user_version=2');
    db.close();
    expect(sessionFromToken(token)).toBeNull();
    expect(revocationsReady()).toBe(false);
  });
  it('rejects malformed metadata and schema rows', () => {
    const db = new DatabaseSync(database);
    db.exec('DELETE FROM metadata');
    db.close();
    expect(sessionFromToken(cookie())).toBeNull();
    expect(revocationsReady()).toBe(false);
  });
  it('leaves guest tokens readable during a store fault', () => {
    const guest = mintGuestToken({ by: 'subject' })!;
    writeFileSync(database, 'corrupt');
    expect(readGuestToken(guest)?.by).toBe('subject');
    expect(createSessionToken({ sub: 'subject', email: 'fixture@example.invalid' })).toBeNull();
  });
  it('fails closed before the first-cut clock', () => {
    const token = cookie();
    vi.setSystemTime(cutoff - 1);
    expect(sessionFromToken(token)).toBeNull();
    expect(revocationsReady()).toBe(false);
    expect(() => revoke('subject')).toThrow();
  });
  it('denies account sessions and health when storage is read-only or inaccessible', () => {
    const token = cookie();
    for (const mode of [0o400, 0o000]) {
      chmodSync(database, mode);
      expect(sessionFromToken(token)).toBeNull();
      expect(revocationsReady()).toBe(false);
      expect(() => revoke('subject', 'retry')).toThrow();
    }
    chmodSync(database, 0o600);
    expect(revoke('subject', 'retry')).toBe(true);
  });
  it('never resets an existing database at initialization', () => {
    revoke('subject');
    const bytes = readFileSync(database);
    expect(() => initializeRevocations()).toThrow();
    expect(readFileSync(database)).toEqual(bytes);
    expect(revokedAfter('subject', Date.now())).toBe(true);
  });
  it('keeps fractional TTL configuration usable when emitting a new cookie', () => {
    const source = resolve('src/lib/auth/session.ts');
    const code = 'Date.now=()=>'+Date.now()+'; const auth=require('+JSON.stringify(source)+'); const token=auth.createSessionToken({sub:"fractional",email:"fixture@example.invalid"}); console.log(Boolean(token && auth.sessionFromToken(token)));';
    const output = execFileSync(process.execPath, ['-r', 'tsx/cjs', '-e', code], {
      encoding: 'utf8', env: { ...process.env, SIGNDROP_SESSION_TTL_HOURS: '1.33333333' },
    }).trim();
    expect(output).toBe('true');
  });
  it('preserves every opaque subject and replay representation without Unicode folding', () => {
    revoke('\ud800', '\ud800');
    expect(revokedAfter('\ud801', Date.now())).toBe(false);
    expect(revoke('\ud801', '\ud801')).toBe(true);
    for (const subject of ['\0subject', 'a\0b', '\ufffd', 'é', 'e\u0301']) {
      expect(revoke(subject)).toBe(true);
      expect(revokedAfter(subject, Date.now())).toBe(true);
    }
  });
  it('observes parallel writers and exact opaque subject representations', async () => {
    const now = Date.now();
    await Promise.all(['a', 'b', 'Subject', 'subject', ' subject '].map(subject => exec(process.execPath, ['-e', `Date.now=()=>${now}; require(${JSON.stringify(STORE)}).revoke(${JSON.stringify(subject)})`], { env: process.env })));
    for (const subject of ['a', 'b', 'Subject', 'subject', ' subject ']) expect(revokedAfter(subject, now)).toBe(true);
    expect(revokedAfter('SUBJECT', now)).toBe(false);
  });
  it('does not commit a replay without its mark when a transaction is interrupted', () => {
    const interrupted = spawnSync(process.execPath, ['-e', `Date.now=()=>${Date.now()}; const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.SIGNDROP_REVOCATION_DB); db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO replays VALUES(?,?)').run(Buffer.from('interrupted', 'utf16le'), Date.now()+600000); process.kill(process.pid, 'SIGKILL');`], { env: process.env });
    expect(interrupted.signal).toBe('SIGKILL');
    expect(revocationsReady()).toBe(true);
    expect(revoke('subject', 'interrupted')).toBe(true);
    expect(revokedAfter('subject', Date.now())).toBe(true);
  });
  it('keeps commit failures retryable and an uncertain committed result denied', () => {
    for (const mode of ['before', 'after']) {
      // Fault only the acknowledgement boundary around REAL SQLite COMMIT.
      // No production fault hook: a fresh child wraps its native constructor.
      const code = `
        Date.now=()=>${Date.now()};
        const native=process.getBuiltinModule('node:sqlite');
        const original=process.getBuiltinModule.bind(process);
        process.getBuiltinModule=id=>id!=='node:sqlite'?original(id):{
          ...native, DatabaseSync:class {
            constructor(...args) {
              const db=new native.DatabaseSync(...args);
              return new Proxy(db,{get(target,key) {
                if(key==='exec') return sql=>{
                  if(sql==='COMMIT' && ${JSON.stringify(mode)}==='before') throw Error('fixture pre-commit fault');
                  const result=target.exec(sql);
                  if(sql==='COMMIT') throw Error('fixture uncertain committed response');
                  return result;
                };
                const value=Reflect.get(target,key,target);
                return typeof value==='function'?value.bind(target):value;
              }});
            }
          }
        };
        try { require(${JSON.stringify(STORE)}).revoke(${JSON.stringify(mode)}, ${JSON.stringify(mode)}); process.exit(1); }
        catch { console.log('commit acknowledgement failed'); }
      `;
      expect(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', env: process.env }).trim()).toBe('commit acknowledgement failed');
      expect(revokedAfter(mode, Date.now())).toBe(mode === 'after');
      expect(revoke(mode, mode)).toBe(mode === 'before');
      expect(revokedAfter(mode, Date.now())).toBe(true);
    }
  });
});
