/**
 * The signature as a thing you can see and click, and a second signature that
 * does not destroy the first.
 *
 * Two claims are checked here, and both used to be false:
 *
 *   1. The signature field carries a widget — /Subtype, /Rect, /F, /P and,
 *      when it is meant to be seen, an /AP — and the page lists it. Without
 *      that, pdfsig invents a widget and warns, and Acrobat shows a signature
 *      nobody can click.
 *   2. Signing an already-signed PDF appends to it. Every byte of the first
 *      revision stays where it was, so the /ByteRange of the first signature
 *      still describes the bytes it signed.
 *
 * The second claim is checked the only way that means anything: by comparing
 * the bytes, and by verifying both signatures afterwards.
 */
import forge from 'node-forge';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle, signPdfWithPades } from '../src/lib/pades/signer.ts';
import { sealPdfDocument } from '../src/lib/pdf/sealer.ts';
import { verifyPdfSignatures } from '../src/lib/pades/verifier.ts';
import { appendIncrementalUpdate, findStartXref, hasSignature, xrefStyle } from '../src/lib/pdf/incremental.ts';

const A = forge.asn1;
let checks = 0;
function ok(condition, name) {
  checks++;
  assert.ok(condition, name);
  console.log(`   ✓ ${name}`);
}

function signer(cn) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'KaiCorp Labs' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = A.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { generateLocalKeyId: true })).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return parsePkcs12Bundle(bytes, 'pw');
}

async function blankContract(useObjectStreams = false) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Contrato entre Ana y Luis', { x: 50, y: 780, size: 12, font });
  return pdf.save({ useObjectStreams });
}

/** The one-by-one PNG the drawn-signature path is exercised with. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ana = signer('Ana Firmante');
const luis = signer('Luis Contraparte');
const original = await blankContract();

const seal = (bytes, p12, stamps, id) =>
  sealPdfDocument({
    originalBytes: bytes,
    stamps,
    pageDimensions: [{ width: 595, height: 842 }],
    includeAuditSheet: true,
    auditData: {
      documentName: 'contrato.pdf',
      originalHash: '',
      timestamp: '2026-09-02 12:00:00',
      signerName: 'Ana',
      signerId: id,
      stampsCount: stamps.length,
      verificationUrl: 'https://sign.example.test/verify',
    },
    p12Data: p12,
  });

/** The signature field of a signed PDF, looked up the way a reader would. */
async function signatureField(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  const refs = [];
  for (let i = 0; i < (fields?.size() ?? 0); i++) refs.push(fields.get(i));
  const dicts = refs.map((r) => doc.context.lookup(r, PDFDict));
  return { doc, refs, dicts };
}

// ─── 1 · The widget ──────────────────────────────────────────────────────────

console.log('1. A signature field that is also a widget');

const drawn = await seal(
  original,
  ana,
  [{ id: 's1', type: 'signature', page: 1, x: 10, y: 80, width: 30, height: 6, content: `data:image/png;base64,${PNG_1x1.toString('base64')}` }],
  'seal_widget'
);
const { doc: drawnDoc, refs: drawnRefs, dicts: drawnFields } = await signatureField(drawn.sealedBytes);
ok(drawnFields.length === 1, 'one signature field');
const field = drawnFields[0];
ok(field.get(PDFName.of('Subtype'))?.toString() === '/Widget', 'it is a /Widget');
ok(field.get(PDFName.of('FT'))?.toString() === '/Sig', 'and a /Sig field: the two dictionaries are merged, as readers expect');
ok(field.get(PDFName.of('F'))?.toString() === '4', 'flagged Print, never hidden');
ok(field.get(PDFName.of('P')) instanceof PDFRef, 'and it knows its page');
const rect = field.lookupMaybe(PDFName.of('Rect'), PDFArray);
const rectValues = rect ? [0, 1, 2, 3].map((i) => Number(rect.get(i).toString())) : [];
ok(rect && rectValues[2] > rectValues[0] && rectValues[3] > rectValues[1], `with a real bounding box: [${rectValues.join(' ')}]`);

const page0 = drawnDoc.getPages()[0];
const annots = page0.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
const annotRefs = [];
for (let i = 0; i < (annots?.size() ?? 0); i++) annotRefs.push(annots.get(i).toString());
ok(annotRefs.includes(drawnRefs[0].toString()), 'and the page lists it in /Annots');

const ap = field.lookupMaybe(PDFName.of('AP'), PDFDict);
const normal = ap?.get(PDFName.of('N'));
ok(normal instanceof PDFRef, 'the widget has a normal appearance stream');
const apStream = drawnDoc.context.lookup(normal);
const bbox = apStream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray);
ok(bbox && Number(bbox.get(2).toString()) === rectValues[2] - rectValues[0], 'whose BBox is the size of the widget');
const apResources = apStream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
ok(apResources?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.get(PDFName.of('SigImg')), 'and it draws the image the person signed with');

console.log('2. A typed signature, and an invisible one');
const typed = await seal(original, ana, [{ id: 's1', type: 'signature', page: 1, x: 10, y: 80, width: 30, height: 6, content: 'Ana Firmante' }], 'seal_typed');
const typedField = (await signatureField(typed.sealedBytes)).dicts[0];
ok(typedField.lookupMaybe(PDFName.of('AP'), PDFDict), 'the typed signature also gets an appearance');
const invisible = await seal(original, ana, [], 'seal_invisible');
const invisibleField = (await signatureField(invisible.sealedBytes)).dicts[0];
ok(invisibleField.get(PDFName.of('Subtype'))?.toString() === '/Widget', 'a signature with nothing to show still gets a widget');
const invisibleRect = invisibleField.lookupMaybe(PDFName.of('Rect'), PDFArray);
ok([0, 1, 2, 3].every((i) => Number(invisibleRect.get(i).toString()) === 0), 'sized zero, which is how an invisible signature is spelt');
ok(!invisibleField.lookupMaybe(PDFName.of('AP'), PDFDict), 'and with no appearance stream to draw');

// ─── 3 · The second signature ────────────────────────────────────────────────

console.log('3. Signing an already-signed PDF appends to it');

const first = drawn.sealedBytes;
ok(hasSignature(first), 'the first signature is detected in the bytes');
ok(xrefStyle(first, findStartXref(first)) === 'table', 'and the file uses a classic cross-reference table');

const second = await signPdfWithPades({
  pdfBytes: first,
  p12Data: luis,
  reason: 'Conforme',
  appearance: { pageIndex: 0, rect: [330, 60, 180, 40] },
});

ok(second.length > first.length, `the file grew rather than being rewritten (+${second.length - first.length} bytes)`);
let identical = second.length >= first.length;
for (let i = 0; identical && i < first.length; i++) if (second[i] !== first[i]) identical = false;
ok(identical, 'and every byte of the first revision is exactly where it was');

const verified = await verifyPdfSignatures(second);
ok(verified.signatures.length === 2, `both signatures are found: ${verified.signatures.length}`);
ok(verified.signatures.every((s) => s.valid), `and both verify: ${verified.signatures.map((s) => s.reason ?? 'ok').join(' / ')}`);
ok(verified.signatures[0].signer?.commonName === 'Ana Firmante' && verified.signatures[1].signer?.commonName === 'Luis Contraparte', 'each under its own signer');
ok(!verified.signatures[0].coversWholeFile, 'the first covers its own revision, not the file: that is what an incremental update means');
ok(verified.signatures[1].coversWholeFile, 'the second covers the whole file');
ok(!verified.modifiedAfterLastSignature, 'and nothing was appended after the last signature');

console.log('4. The first signature still covers the same bytes it did');
const before = await verifyPdfSignatures(first);
ok(before.signatures[0].byteRange.join() === verified.signatures[0].byteRange.join(), `the byte range is untouched: [${verified.signatures[0].byteRange.join(' ')}]`);

console.log('5. A third signature still leaves the first two alone');
const third = await signPdfWithPades({ pdfBytes: second, p12Data: ana, reason: 'Y de nuevo Ana' });
const three = await verifyPdfSignatures(third);
ok(three.signatures.length === 3 && three.signatures.every((s) => s.valid), 'three signatures, all valid');
ok(three.signatures[2].coversWholeFile && !three.modifiedAfterLastSignature, 'and the newest one covers everything');

// ─── 6 · Cross-reference streams ─────────────────────────────────────────────

console.log('6. A file written with cross-reference streams is appended to in its own style');

const modern = await blankContract(true);
ok(xrefStyle(modern, findStartXref(modern)) === 'stream', 'the fixture really uses a cross-reference stream');
const modernDoc = await PDFDocument.load(modern, { ignoreEncryption: true });
const note = modernDoc.context.register(modernDoc.context.obj({ Type: 'Note', Body: 'appended' }));
const appended = appendIncrementalUpdate({ original: modern, context: modernDoc.context, changed: [note] });
let prefixIntact = appended.length > modern.length;
for (let i = 0; prefixIntact && i < modern.length; i++) if (appended[i] !== modern[i]) prefixIntact = false;
ok(prefixIntact, 'the original bytes are untouched');
ok(xrefStyle(appended, findStartXref(appended)) === 'stream', 'and the appended section is a cross-reference stream too');
const reloaded = await PDFDocument.load(appended, { ignoreEncryption: true });
ok(reloaded.getPages().length === 1, 'the result still parses, with its page');
ok(reloaded.context.lookup(note, PDFDict)?.get(PDFName.of('Type'))?.toString() === '/Note', 'and the appended object is reachable through the new cross-reference stream');

console.log('7. An update with nothing in it is refused');
let refused = false;
try {
  appendIncrementalUpdate({ original: modern, context: modernDoc.context, changed: [] });
} catch {
  refused = true;
}
ok(refused, 'rather than writing a revision that says nothing');

console.log('8. A document big enough to be a real one');

// Not a benchmark, a floor. Every byte-to-string conversion in the signer and
// the verifier used to go through String.fromCharCode.apply, which throws
// RangeError past about a hundred kilobytes, and the check for "is this file
// already signed" built the whole file as a string one character at a time.
// A twelve-megabyte contract went from impossible to signing in well under a
// second; what this asserts is only that it works at all, because a timing
// assertion in CI is a flake waiting to happen.
const big = await PDFDocument.create();
const bigFont = await big.embedFont(StandardFonts.Helvetica);
const filler = new Uint8Array(1024 * 1024);
for (let i = 0; i < filler.length; i++) filler[i] = (Math.random() * 256) | 0;
for (let i = 0; i < 12; i++) {
  const p = big.addPage([595, 842]);
  p.drawText(`Anexo ${i + 1}`, { x: 50, y: 780, size: 12, font: bigFont });
  big.context.register(big.context.stream(filler.slice(0, 1024 * 1024)));
}
const bigBytes = await big.save({ useObjectStreams: false });
ok(bigBytes.length > 10 * 1024 * 1024, `${(bigBytes.length / 1048576).toFixed(1)} MB of contract`);
const started = Date.now();
const bigSigned = await signPdfWithPades({ pdfBytes: bigBytes, p12Data: ana });
const bigVerified = await verifyPdfSignatures(bigSigned);
ok(bigVerified.signatures.length === 1 && bigVerified.signatures[0].valid, `signed and verified in ${((Date.now() - started) / 1000).toFixed(2)} s`);
ok(bigVerified.signatures[0].coversWholeFile, 'and the signature covers all of it');

console.log(`\n✅ ${checks} checks passed.`);
