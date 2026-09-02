/**
 * Writes a PDF signed with a throwaway self-signed certificate, for checking
 * SignDrop's signatures with verifiers that are not ours: pdfsig (poppler),
 * Acrobat, pdf-verify. Usage: npx tsx scripts/sample-signed-pdf.mjs out.pdf
 */
import forge from 'node-forge';
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle } from '../src/lib/pades-signer.ts';
import { sealPdfDocument } from '../src/lib/pdf-sealer.ts';
const A = forge.asn1;
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey; cert.serialNumber = '0102030405';
cert.validity.notBefore = new Date(Date.now() - 86400e3); cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
const attrs = [{ name: 'commonName', value: 'Ana Firmante' }, { name: 'organizationName', value: 'KaiCorp Labs' }];
cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = A.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { generateLocalKeyId: true })).getBytes();
const p12b = new Uint8Array(p12.length); for (let i = 0; i < p12.length; i++) p12b[i] = p12.charCodeAt(i);
const parsed = parsePkcs12Bundle(p12b, 'pw');
const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('Contrato de prueba', { x: 50, y: 780, size: 12, font });
const original = await pdf.save({ useObjectStreams: false });
const out = await sealPdfDocument({ originalBytes: original, stamps: [], pageDimensions: [{ width: 595, height: 842 }], includeAuditSheet: true,
  auditData: { documentName: 'contrato.pdf', originalHash: '', timestamp: '2026-09-02 12:00:00', signerName: 'Ana', signerId: 'seal_sample', stampsCount: 0, verificationUrl: 'https://sign.example.test/verify' }, p12Data: parsed });
writeFileSync(process.argv[2], out.sealedBytes);
writeFileSync(process.argv[2] + '.cert.pem', forge.pki.certificateToPem(cert));
console.log('written', out.sealedBytes.length, 'bytes, signed:', out.isPadesSigned);
