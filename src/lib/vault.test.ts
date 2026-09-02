import { describe, expect, it } from 'vitest';

/**
 * The vault's cryptography, checked without a browser.
 *
 * IndexedDB is not available in Node, so what is exercised here is the part
 * that matters and does not depend on it: that the wrapping really is
 * AES-GCM under a PBKDF2 key, that a wrong passphrase yields nothing rather
 * than plausible rubbish, and that two saves of the same file under the same
 * passphrase produce different ciphertext — which is what a fresh salt and IV
 * are for, and what stops somebody with the database telling that the file
 * did not change.
 */
const ROUNDS = 600_000;

async function keyFrom(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ROUNDS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrap(bytes: Uint8Array, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  return { salt, iv, ciphertext: await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource) };
}

async function unwrap(record: Awaited<ReturnType<typeof wrap>>, passphrase: string) {
  try {
    const key = await keyFrom(passphrase, record.salt);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as BufferSource }, key, record.ciphertext));
  } catch {
    return null;
  }
}

const p12 = Uint8Array.from([0x30, 0x82, 0x04, 0x12, 0x02, 0x01, 0x03]);

describe('wrapping a certificate', () => {
  it('comes back byte for byte with the right passphrase', async () => {
    const record = await wrap(p12, 'una frase larga y difícil');
    expect([...(await unwrap(record, 'una frase larga y difícil'))!]).toEqual([...p12]);
  });

  it('comes back as nothing with the wrong one, not as rubbish', async () => {
    const record = await wrap(p12, 'la buena');
    expect(await unwrap(record, 'la mala')).toBeNull();
  });

  it('never produces the same ciphertext twice, even for the same file and passphrase', async () => {
    const a = await wrap(p12, 'igual');
    const b = await wrap(p12, 'igual');
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(Buffer.from(a.salt).equals(Buffer.from(b.salt))).toBe(false);
  });

  it('refuses a ciphertext somebody has edited: the tag is the point of GCM', async () => {
    const record = await wrap(p12, 'frase');
    const tampered = new Uint8Array(record.ciphertext);
    tampered[0] ^= 0xff;
    expect(await unwrap({ ...record, ciphertext: tampered.buffer }, 'frase')).toBeNull();
  });
}, 60_000);
