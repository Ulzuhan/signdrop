/**
 * Reading and patching a PDF as bytes, never as a string.
 *
 * A PDF is a binary file with ASCII structure in it, and the tempting move is
 * to turn the whole thing into a JavaScript string so `indexOf` works. It
 * costs a full copy, and the obvious way of building that string —
 * concatenating one character at a time — is quadratic: checking whether a
 * fifty-megabyte document already carried a signature took four seconds on
 * its own, which was most of the time the signature took.
 *
 * So the searches happen over the bytes. The needles are short ASCII runs
 * (`/ByteRange [`, `startxref`), which is what makes a plain scan the right
 * algorithm here rather than something cleverer.
 */

/** First occurrence of an ASCII needle at or after `from`, or -1. */
export function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  const first = needle.charCodeAt(0);
  const last = haystack.length - needle.length;
  outer: for (let i = Math.max(from, 0); i <= last; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** Last occurrence at or before `before`, or -1. */
export function lastIndexOfAscii(haystack: Uint8Array, needle: string, before: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = Math.min(before, haystack.length - needle.length); i >= 0; i--) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** Overwrites in place. Only ever used with runs the same length as what they replace. */
export function writeAscii(target: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[at + i] = text.charCodeAt(i) & 0xff;
}

/** A slice as a latin-1 string. For short runs — a trailer, a keyword — not for files. */
export function sliceAscii(bytes: Uint8Array, from: number, to: number): string {
  const CHUNK = 8192;
  const end = Math.min(to, bytes.length);
  if (end - from <= CHUNK) return String.fromCharCode(...bytes.subarray(Math.max(from, 0), end));
  const pieces: string[] = [];
  for (let i = Math.max(from, 0); i < end; i += CHUNK) pieces.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, end))));
  return pieces.join('');
}

/** Bytes of an ASCII string. */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
