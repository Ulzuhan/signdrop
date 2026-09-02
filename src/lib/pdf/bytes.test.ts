import { describe, expect, it } from 'vitest';
import { ascii, indexOfAscii, lastIndexOfAscii, sliceAscii, writeAscii } from './bytes';

/**
 * The searches a signature depends on.
 *
 * These four functions decide where the /ByteRange is written and which bytes
 * a signature covers. An off-by-one here is not a rendering glitch: it is a
 * signature over the wrong bytes, which verifies as tampering.
 */
describe('finding ASCII in a PDF', () => {
  const pdf = ascii('%PDF-1.7\n/ByteRange [0 0 0 0]\ntrailer\nstartxref\n1234\n%%EOF\n');

  it('finds a needle and reports where it starts', () => {
    expect(indexOfAscii(pdf, '/ByteRange')).toBe(9);
    expect(sliceAscii(pdf, 9, 19)).toBe('/ByteRange');
  });

  it('answers -1 rather than 0 when there is nothing to find', () => {
    expect(indexOfAscii(pdf, '/Contents')).toBe(-1);
    expect(lastIndexOfAscii(pdf, '/Contents', pdf.length)).toBe(-1);
  });

  it('starts where it is told to', () => {
    const twice = ascii('aXbXc');
    expect(indexOfAscii(twice, 'X')).toBe(1);
    expect(indexOfAscii(twice, 'X', 2)).toBe(3);
  });

  it('searches backwards from a point, not from the end', () => {
    const twice = ascii('aXbXc');
    expect(lastIndexOfAscii(twice, 'X', 4)).toBe(3);
    expect(lastIndexOfAscii(twice, 'X', 2)).toBe(1);
  });

  it('does not run off either end', () => {
    expect(indexOfAscii(pdf, 'EOF', pdf.length + 100)).toBe(-1);
    expect(lastIndexOfAscii(pdf, '%PDF', -5)).toBe(-1);
    expect(indexOfAscii(ascii('ab'), 'abc')).toBe(-1);
  });

  it('matches bytes, not text: a partial prefix is not a match', () => {
    expect(indexOfAscii(ascii('startxre'), 'startxref')).toBe(-1);
  });
});

describe('overwriting in place', () => {
  it('writes exactly as many bytes as the text has', () => {
    const buffer = ascii('/ByteRange [0000000000]');
    writeAscii(buffer, 12, '42');
    expect(sliceAscii(buffer, 0, buffer.length)).toBe('/ByteRange [4200000000]');
  });

  it('leaves the length alone, which is what keeps xref offsets true', () => {
    const buffer = ascii('0123456789');
    const before = buffer.length;
    writeAscii(buffer, 3, 'abc');
    expect(buffer.length).toBe(before);
  });
});

describe('slicing to a string', () => {
  it('survives more bytes than String.fromCharCode takes as arguments', () => {
    // The bug this replaced: fromCharCode.apply over the whole buffer throws
    // RangeError somewhere past a hundred thousand arguments, so the verifier
    // died on any document worth signing.
    const big = new Uint8Array(300_000).fill(0x41);
    const text = sliceAscii(big, 0, big.length);
    expect(text.length).toBe(300_000);
    expect(text.slice(0, 4)).toBe('AAAA');
  });

  it('clamps to the buffer rather than inventing characters', () => {
    const small = ascii('abc');
    expect(sliceAscii(small, 1, 99)).toBe('bc');
    expect(sliceAscii(small, -5, 2)).toBe('ab');
  });
});
