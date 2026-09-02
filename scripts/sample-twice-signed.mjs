/**
 * Writes a PDF signed by two different people, for verifiers that are not
 * ours. The point is the FIRST signature: after the second one is appended it
 * must still verify and must report that it covers its own revision rather
 * than the whole file.
 *
 *   npx tsx scripts/sample-twice-signed.mjs out.pdf
 */
import forge from 'node-forge';
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle, signPdfWithPades } from '../src/lib/pades/signer.ts';

const A = forge.asn1;

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

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
page.drawText('Contrato entre Ana y Luis', { x: 50, y: 780, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
const original = await pdf.save({ useObjectStreams: false });

const first = await signPdfWithPades({
  pdfBytes: original,
  p12Data: signer('Ana Firmante'),
  appearance: { pageIndex: 0, rect: [60, 60, 180, 40] },
});
const second = await signPdfWithPades({
  pdfBytes: first,
  p12Data: signer('Luis Contraparte'),
  appearance: { pageIndex: 0, rect: [330, 60, 180, 40] },
});

writeFileSync(process.argv[2], second);
console.log(`written ${second.length} bytes; the first revision was ${first.length} and is untouched`);
