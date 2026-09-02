import { createHmac } from 'node:crypto';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle, signPdfWithPades } from '../../src/lib/pades/signer';
import { SESSION_SECRET } from '../../playwright.config';

/**
 * Everything the browser tests need, made here rather than committed.
 *
 * A `.p12` in a repository is a `.p12` somebody will eventually use for
 * something, and a signed PDF checked in goes stale the moment the signer
 * changes. Both are cheap to build.
 */

/** A session cookie, sealed exactly as src/lib/auth/session.ts seals one. */
export function sessionCookie(sub = 'e2e-persona') {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ sub, email: `${sub}@example.invalid`, name: 'Persona de pruebas', iat: now, exp: now + 3600_000 })
  ).toString('base64url');
  return {
    name: 'signdrop_session',
    value: `${payload}.${createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')}`,
    domain: '127.0.0.1',
    path: '/',
  };
}

export function throwawayCertificate(commonName = 'Ana Firmante') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'KaiCorp Labs' },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { generateLocalKeyId: true })).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return { p12: bytes, password: 'pw', commonName };
}

export async function blankContract(title = 'Contrato de prueba') {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawText(title, { x: 50, y: 780, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save({ useObjectStreams: false });
}

/** A contract already signed, for the half of the product that needs no account. */
export async function signedContract() {
  const { p12, password, commonName } = throwawayCertificate();
  const signed = await signPdfWithPades({
    pdfBytes: await blankContract(),
    p12Data: parsePkcs12Bundle(p12, password),
    appearance: { pageIndex: 0, rect: [60, 60, 200, 44] },
  });
  return { bytes: Buffer.from(signed), commonName };
}
