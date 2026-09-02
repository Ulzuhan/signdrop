/**
 * Cryptographic utility functions for SignDrop.
 * 100% Zero-Knowledge: Calculations run entirely in browser memory.
 */

export async function calculateSha256(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    // Standard Web Crypto API (Browser & Node 18+)
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Fallback for older environments / Node runtime if needed
  try {
    const { createHash } = await import('crypto');
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    throw new Error('No cryptographic hashing provider available.');
  }
}

export function formatShortHash(hash: string, startChars = 8, endChars = 8): string {
  if (!hash || hash.length <= startChars + endChars) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}

export function generateRandomId(prefix = 'sig'): string {
  const random = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}${random}`;
}
