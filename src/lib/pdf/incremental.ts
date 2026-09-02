/**
 * Signing a PDF that is already signed, without destroying the first
 * signature.
 *
 * pdf-lib saves by writing the whole file again. Every byte moves, and the
 * first signature's /ByteRange — which is a promise about byte offsets —
 * stops describing anything. The document comes out with two signatures of
 * which one is broken, which is worse than refusing to sign it.
 *
 * PAdES says what to do instead, and it is what every reader expects: leave
 * the original file untouched and append. The appended section carries only
 * the objects that are new or changed — the signature dictionary, the field
 * and its widget, the page that now lists that widget, the AcroForm, the
 * catalog — followed by a cross-reference section covering just those, whose
 * /Prev points at the previous one. A reader walks the chain backwards and
 * sees the newest version of every object; a verifier hashing the first
 * signature's byte range still finds the bytes it signed, because they never
 * moved.
 *
 * Two cross-reference styles exist and a file must be appended to in its own:
 * the classic `xref` table, and the cross-reference stream of PDF 1.5. Both
 * are written here — refusing the second would mean refusing most documents
 * that come out of Word or Acrobat.
 *
 * What this does NOT do is decide what may change. A second signature is only
 * legitimate if the first one allowed it (/DocMDP), and that check belongs to
 * the verifier, which reports whether each signature covers its own revision.
 */
import { PDFArray, PDFContext, PDFObject, PDFRef } from 'pdf-lib';
import { ascii, indexOfAscii, sliceAscii } from './bytes';

/** Where the file's most recent cross-reference section starts. */
export function findStartXref(bytes: Uint8Array): number {
  // The spec allows junk after %%EOF, so search the tail rather than assume
  // the file ends exactly where it should.
  const window = Math.min(bytes.length, 2048);
  const tail = sliceAscii(bytes, bytes.length - window, bytes.length);
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('the PDF has no startxref; it cannot be appended to safely');
  const offset = Number(last[1]);
  if (!Number.isFinite(offset) || offset <= 0 || offset >= bytes.length) {
    throw new Error(`the PDF's startxref points outside the file (${last[1]})`);
  }
  return offset;
}

/** 'table' for a classic `xref`, 'stream' for a PDF 1.5 cross-reference stream. */
export function xrefStyle(bytes: Uint8Array, startXref: number): 'table' | 'stream' {
  return sliceAscii(bytes, startXref, startXref + 4) === 'xref' ? 'table' : 'stream';
}

/**
 * Does this file already carry a signature? Then it must be appended to, not
 * rewritten.
 *
 * Scanned over the bytes. Turning the file into a string to use `includes`
 * cost four seconds on a fifty-megabyte document, which was most of what
 * signing one took.
 */
export function hasSignature(bytes: Uint8Array): boolean {
  if (indexOfAscii(bytes, '/ByteRange') === -1) return false;
  return indexOfAscii(bytes, '/Type /Sig') !== -1 || indexOfAscii(bytes, '/Type/Sig') !== -1 || indexOfAscii(bytes, '/Adobe.PPKLite') !== -1;
}

function serializeObject(object: PDFObject): Uint8Array {
  const buffer = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(buffer, 0);
  return buffer;
}

const hex16 = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Consecutive object numbers, grouped as a cross-reference section wants them. */
function subsections(entries: { num: number; offset: number; gen: number }[]) {
  const sorted = [...entries].sort((a, b) => a.num - b.num);
  const groups: { start: number; items: typeof sorted }[] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && entry.num === last.start + last.items.length) last.items.push(entry);
    else groups.push({ start: entry.num, items: [entry] });
  }
  return groups;
}

export interface IncrementalSaveOptions {
  /** The file as it arrived. Not one byte of it is changed. */
  original: Uint8Array;
  context: PDFContext;
  /** Objects to write: everything created or modified since the file was read. */
  changed: PDFRef[];
}

/**
 * The original file with an incremental update appended.
 *
 * Offsets in the new cross-reference section are absolute in the returned
 * buffer, so anything done to it afterwards must not change its length —
 * which is exactly the contract the signature placeholder already works
 * under: the /Contents hex and the /ByteRange are both padded to a fixed
 * width and overwritten in place.
 */
export function appendIncrementalUpdate({ original, context, changed }: IncrementalSaveOptions): Uint8Array {
  if (changed.length === 0) throw new Error('an incremental update with no changed objects would say nothing');

  const startXref = findStartXref(original);
  const style = xrefStyle(original, startXref);

  const parts: Uint8Array[] = [];
  let offset = original.length;
  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
    offset += chunk.length;
  };

  parts.push(original);
  // An update must start on its own line; a file that already ends in one
  // gets no second.
  if (original[original.length - 1] !== 0x0a) push(ascii('\n'));

  // A cross-reference stream is itself an object, and it needs a number
  // before the entries that describe it can be written.
  const xrefStreamRef = style === 'stream' ? context.nextRef() : null;

  const entries: { num: number; offset: number; gen: number }[] = [];
  for (const ref of changed) {
    const object = context.lookup(ref);
    if (!object) continue;
    entries.push({ num: ref.objectNumber, offset, gen: ref.generationNumber });
    push(ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(serializeObject(object));
    push(ascii('\nendobj\n'));
  }
  if (entries.length === 0) throw new Error('none of the changed objects could be resolved');

  const size = Math.max(context.largestObjectNumber + 1, ...entries.map((e) => e.num + 1));
  const root = context.trailerInfo.Root;
  if (!root) throw new Error('the PDF has no /Root; it cannot be appended to');
  const info = context.trailerInfo.Info;
  // /ID: the first half identifies the document across its versions, the
  // second this version. A file with no ID gets one — Acrobat wants it, and
  // an update is as good a moment as any.
  const existingId = context.trailerInfo.ID;
  const permanentId =
    existingId instanceof PDFArray && existingId.size() > 0 ? existingId.get(0).toString() : `<${hex16()}>`;
  const idPair = `[${permanentId} <${hex16()}>]`;

  const xrefOffset = offset;
  if (style === 'table') {
    let table = 'xref\n';
    for (const group of subsections(entries)) {
      table += `${group.start} ${group.items.length}\n`;
      for (const item of group.items) {
        table += `${String(item.offset).padStart(10, '0')} ${String(item.gen).padStart(5, '0')} n \n`;
      }
    }
    table += 'trailer\n';
    table += `<< /Size ${size} /Root ${root.toString()}${info ? ` /Info ${info.toString()}` : ''} /Prev ${startXref} /ID ${idPair} >>\n`;
    table += `startxref\n${xrefOffset}\n%%EOF\n`;
    push(ascii(table));
  } else {
    // Cross-reference stream. /W [1 4 2]: one byte of entry type, four of
    // offset, two of generation. Written without a filter — a compressed
    // stream would save a few hundred bytes and cost a dependency the browser
    // build does not otherwise need.
    const all = [...entries, { num: xrefStreamRef!.objectNumber, offset: xrefOffset, gen: 0 }];
    const groups = subsections(all);
    const data = new Uint8Array(all.length * 7);
    let at = 0;
    for (const group of groups) {
      for (const item of group.items) {
        data[at] = 1;
        data[at + 1] = (item.offset >>> 24) & 0xff;
        data[at + 2] = (item.offset >>> 16) & 0xff;
        data[at + 3] = (item.offset >>> 8) & 0xff;
        data[at + 4] = item.offset & 0xff;
        data[at + 5] = (item.gen >>> 8) & 0xff;
        data[at + 6] = item.gen & 0xff;
        at += 7;
      }
    }
    const index = groups.flatMap((g) => [g.start, g.items.length]).join(' ');
    const streamSize = Math.max(size, xrefStreamRef!.objectNumber + 1);
    const header =
      `${xrefStreamRef!.objectNumber} 0 obj\n` +
      `<< /Type /XRef /Size ${streamSize} /Index [${index}] /W [1 4 2] /Root ${root.toString()}` +
      `${info ? ` /Info ${info.toString()}` : ''} /Prev ${startXref} /ID ${idPair} /Length ${data.length} >>\nstream\n`;
    push(ascii(header));
    push(data);
    push(ascii(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`));
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
