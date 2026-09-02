/**
 * Keeping a certificate in this browser, and only in this browser.
 *
 * The problem it solves is small and real: signing three documents means
 * finding the `.p12` and typing its password three times, and the usual way
 * people solve that is to leave the file somewhere convenient — the desktop,
 * a shared drive, an email to themselves. Any of those is worse than what is
 * here.
 *
 * What is here: the bytes of the `.p12`, encrypted with AES-GCM under a key
 * derived from a passphrase the person chooses, in IndexedDB. The passphrase
 * is never stored and never leaves the page; without it the record is a blob
 * nobody can do anything with, including us. 600,000 rounds of PBKDF2-SHA-256
 * is OWASP's current figure and costs about half a second on a phone, which
 * is the point — it is what makes guessing the passphrase expensive.
 *
 * What this is NOT: a key store. It does not protect against somebody who
 * controls this browser, and it does not pretend to. It protects against the
 * `.p12` sitting unencrypted in a downloads folder, and against somebody
 * borrowing the laptop for five minutes. Forgetting it is one click and it is
 * a real delete, not a flag.
 *
 * Nothing here reaches the network. The server has no idea this exists.
 */

const DB_NAME = 'signdrop';
const DB_VERSION = 1;
const STORE = 'vault';
const RECORD = 'certificate';

/** OWASP's recommendation for PBKDF2-HMAC-SHA256, as of 2026. */
const PBKDF2_ROUNDS = 600_000;

export interface StoredCertificate {
  /** What to call it in the interface. Never anything secret. */
  label: string;
  savedAt: number;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'));
      })
  );
}

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Whether this browser has a certificate put away, and what it is called. */
export async function storedCertificate(): Promise<{ label: string; savedAt: number } | null> {
  try {
    const record = await transact<StoredCertificate | undefined>('readonly', (s) => s.get(RECORD));
    return record ? { label: record.label, savedAt: record.savedAt } : null;
  } catch {
    // A private window, or a browser that will not open IndexedDB. Not having
    // somewhere to put it is not an error worth interrupting anybody with.
    return null;
  }
}

export async function rememberCertificate(bytes: ArrayBuffer, passphrase: string, label: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes);
  const record: StoredCertificate = { label: label.slice(0, 80), savedAt: Date.now(), salt, iv, ciphertext };
  await transact('readwrite', (s) => s.put(record, RECORD));
}

/**
 * The bytes back, or null if the passphrase is wrong.
 *
 * Null rather than an exception because a wrong passphrase is the expected
 * case, not a failure: AES-GCM's authentication tag is what tells them apart,
 * and it tells them apart properly — there is no way to decrypt "most of" the
 * file with the wrong key.
 */
export async function recallCertificate(passphrase: string): Promise<ArrayBuffer | null> {
  const record = await transact<StoredCertificate | undefined>('readonly', (s) => s.get(RECORD));
  if (!record) return null;
  try {
    const key = await keyFrom(passphrase, record.salt);
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as BufferSource }, key, record.ciphertext);
  } catch {
    return null;
  }
}

/** Gone. One click, and a real delete. */
export async function forgetCertificate(): Promise<void> {
  try {
    await transact('readwrite', (s) => s.delete(RECORD));
  } catch {
    // Nothing to forget is the same outcome as forgetting it.
  }
}
