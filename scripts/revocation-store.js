/** Durable auth state, shared by the launcher and the Next server. Node 24+. */
const fs = require('node:fs');
const path = require('node:path');
// Turbopack 16 cannot externalize the new builtin as a CommonJS URL. This
// official Node API keeps lookup in the Node runtime, also in standalone.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const VERSION = 1;
const REPLAY_MS = 10 * 60 * 1000;

// Preserve the exact JS string, including NUL and unpaired surrogate code
// units. Binding SQLite TEXT as UTF-8 would collapse distinct opaque ids.
function opaqueKey(value) { return Buffer.from(value, 'utf16le'); }

function filename() {
  const value = process.env.SIGNDROP_REVOCATION_DB;
  if (!value || !path.isAbsolute(value)) throw new Error('Revocation database requires an absolute path');
  return value;
}

function privateFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.size === 0 || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())) {
    throw new Error('Revocation database must be an initialized private file owned by the runtime user');
  }
}

function metadata(db) {
  if (db.prepare('PRAGMA user_version').get().user_version !== VERSION ||
      db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
    throw new Error('Unsupported or corrupt revocation database');
  }
  const rows = db.prepare('SELECT minimum_issued_at FROM metadata').all();
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0].minimum_issued_at) || rows[0].minimum_issued_at <= 0) {
    throw new Error('Invalid revocation metadata');
  }
  // Validate the entire tiny auth store, rather than ignoring a malformed row.
  if (db.prepare('SELECT 1 FROM revocations WHERE typeof(subject) != ? OR length(subject) = 0 OR length(subject) % 2 != 0 OR typeof(at) != ? OR at < ? LIMIT 1')
    .get('blob', 'integer', rows[0].minimum_issued_at) ||
      db.prepare('SELECT 1 FROM replays WHERE typeof(jti) != ? OR length(jti) = 0 OR length(jti) % 2 != 0 OR typeof(expires_at) != ? OR expires_at < ? LIMIT 1')
    .get('blob', 'integer', rows[0].minimum_issued_at)) throw new Error('Invalid revocation row');
  return rows[0].minimum_issued_at;
}

function withDatabase(readOnly, fn) {
  const file = filename();
  privateFile(file);
  // A fresh connection per request observes commits from every bundle/process.
  // No operation initializes missing state or its schema.
  const db = new DatabaseSync(file, { readOnly, timeout: 2000 });
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    return fn(db);
  } finally {
    db.close();
  }
}

/** Explicit first cut only. Existing/partial files are never reset or migrated. */
function initializeRevocations() {
  const file = filename();
  const parent = fs.lstatSync(path.dirname(file));
  if (!parent.isDirectory() || (parent.mode & 0o077) !== 0 ||
      (process.getuid && parent.uid !== process.getuid())) throw new Error('Revocation directory must be private and owned by the runtime user');
  fs.closeSync(fs.openSync(file, 'wx', 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      BEGIN IMMEDIATE;
      CREATE TABLE metadata(id INTEGER PRIMARY KEY CHECK(id=1), minimum_issued_at INTEGER NOT NULL CHECK(minimum_issued_at>0)) STRICT;
      CREATE TABLE revocations(subject BLOB PRIMARY KEY NOT NULL CHECK(length(subject)>0 AND length(subject)%2=0), at INTEGER NOT NULL CHECK(at>0)) STRICT;
      CREATE TABLE replays(jti BLOB PRIMARY KEY NOT NULL CHECK(length(jti)>0 AND length(jti)%2=0), expires_at INTEGER NOT NULL CHECK(expires_at>0)) STRICT;
      PRAGMA user_version=1;`);
    db.prepare('INSERT INTO metadata VALUES(1, ?)').run(Date.now());
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function revocationsReady() {
  try {
    return withDatabase(false, db => {
      db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
      try {
        const cut = metadata(db);
        if (Date.now() < cut) throw new Error('Clock precedes first cut');
        // Force a journal write: merely taking a lock can succeed on a
        // read-only mount and would falsely report readiness.
        db.prepare('UPDATE metadata SET minimum_issued_at = ? WHERE id=1').run(cut);
        db.exec('ROLLBACK');
        return true;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    });
  } catch { return false; }
}

/** A replay and its revocation are committed together; failure remains retryable. */
function revoke(subject, jti) {
  if (subject !== undefined && (typeof subject !== 'string' || !subject)) throw new Error('Invalid subject');
  if (jti !== undefined && (typeof jti !== 'string' || !jti)) throw new Error('Invalid logout id');
  return withDatabase(false, db => {
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    try {
      const cut = metadata(db);
      const now = Date.now();
      if (now < cut) throw new Error('Clock precedes first cut');
      db.prepare('DELETE FROM replays WHERE expires_at <= ?').run(now);
      if (jti && db.prepare('SELECT 1 FROM replays WHERE jti = ?').get(opaqueKey(jti))) {
        db.exec('ROLLBACK');
        return false;
      }
      if (subject) db.prepare('INSERT INTO revocations(subject, at) VALUES(?, ?) ON CONFLICT(subject) DO UPDATE SET at = max(at, excluded.at)').run(opaqueKey(subject), now);
      if (jti) db.prepare('INSERT INTO replays(jti, expires_at) VALUES(?, ?)').run(opaqueKey(jti), now + REPLAY_MS);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  });
}

function revokedAfter(subject, issuedAt) {
  if (typeof subject !== 'string' || !subject || !Number.isSafeInteger(issuedAt)) throw new Error('Invalid session claims');
  return withDatabase(false, db => {
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    try {
      const cut = metadata(db);
      // Authentication also fails closed when the store cannot accept notices.
      db.prepare('UPDATE metadata SET minimum_issued_at = ? WHERE id=1').run(cut);
      if (Date.now() < cut || issuedAt <= cut) return true;
      const row = db.prepare('SELECT at FROM revocations WHERE subject = ?').get(opaqueKey(subject));
      return row !== undefined && issuedAt <= row.at;
    } finally { db.exec('ROLLBACK'); }
  });
}

module.exports = { initializeRevocations, revocationsReady, revoke, revokedAfter };
