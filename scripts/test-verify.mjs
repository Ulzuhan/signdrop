/**
 * The verifier, against what it exists to catch.
 *
 * A synthetic signer certificate and a synthetic TSA — a second key with the
 * timeStamping extended key usage — so nothing here touches the network. The
 * TSA builds a real RFC 3161 token (a CMS SignedData over a TSTInfo) exactly
 * as a TSA would, so what gets embedded and what gets verified is the real
 * format, not a stand-in.
 */
import forge from 'node-forge';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle } from '../src/lib/pades-signer.ts';
import { sealPdfDocument } from '../src/lib/pdf-sealer.ts';
import { buildTimeStampRequest, parseTimeStampResponse } from '../src/lib/tsa-client.ts';
import { verifyPdfSignatures } from '../src/lib/pades-verifier.ts';

const A = forge.asn1;
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

let checks = 0;
function ok(condition, name) {
  checks++;
  assert.ok(condition, name);
  console.log(`   ✓ ${name}`);
}

function makeCert({ cn, org, keyUsageTimeStamping = false, days = 365 }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + days * 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: org }, { name: 'countryName', value: 'ES' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const ext = [{ name: 'basicConstraints', cA: false }];
  if (keyUsageTimeStamping) ext.push({ name: 'extKeyUsage', timeStamping: true });
  cert.setExtensions(ext);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

function makeP12({ cert, keys }, password) {
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { generateLocalKeyId: true, friendlyName: 'test' });
  const der = A.toDer(p12).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return bytes;
}

/** A TSA in ten lines: reads the request's imprint, answers with a signed TSTInfo. */
function makeTsa({ cert, keys }, { lie = false } = {}) {
  return (requestDer) => {
    const req = A.fromDer(forge.util.binary.raw.encode(requestDer));
    const imprint = req.value[1];
    const imprintBytes = lie ? forge.random.getBytesSync(32) : imprint.value[1].value;
    const genTime = new Date();
    const tstInfo = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
      A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, A.integerToDer(1).getBytes()),
      A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer('1.3.6.1.4.1.99999.1').getBytes()),
      A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
        A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
          A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer(OID_SHA256).getBytes()),
          A.create(A.Class.UNIVERSAL, A.Type.NULL, false, ''),
        ]),
        A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, imprintBytes),
      ]),
      A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, forge.util.hexToBytes('0a1b2c')),
      A.create(A.Class.UNIVERSAL, A.Type.GENERALIZEDTIME, false, A.dateToGeneralizedTime(genTime)),
    ]);
    const tstDer = A.toDer(tstInfo).getBytes();

    const p7 = forge.pkcs7.createSignedData();
    // forge replaces contentInfo with a Data one unless `content` is an object.
    p7.content = {};
    p7.contentInfo = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
      A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer(OID_TST_INFO).getBytes()),
      A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, tstDer)]),
    ]);
    p7.addCertificate(cert);
    p7.addSigner({
      key: keys.privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: OID_TST_INFO },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: genTime },
      ],
    });
    p7.sign();
    const token = p7.toAsn1();
    const resp = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
      A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, A.integerToDer(0).getBytes())]),
      token,
    ]);
    const der = A.toDer(resp).getBytes();
    const bytes = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
    return { bytes, genTime };
  };
}

async function contract() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Contrato de prueba. Las partes acuerdan lo que sigue.', { x: 50, y: 780, size: 12, font });
  return pdf.save({ useObjectStreams: false });
}

async function seal(original, p12, tsa) {
  return sealPdfDocument({
    originalBytes: original,
    stamps: [],
    pageDimensions: [{ width: 595, height: 842 }],
    includeAuditSheet: true,
    auditData: {
      documentName: 'contrato.pdf',
      originalHash: '',
      timestamp: '2026-09-02 12:00:00',
      signerName: 'Ana',
      signerId: 'seal_test_verify',
      stampsCount: 0,
      verificationUrl: 'https://sign.example.test/verify',
    },
    p12Data: p12,
    timestamp: tsa
      ? async (signatureValue) => {
          const md = forge.md.sha256.create();
          md.update(forge.util.binary.raw.encode(signatureValue));
          const { bytes } = tsa(buildTimeStampRequest(md.digest().toHex()));
          return parseTimeStampResponse(bytes).tokenDer;
        }
      : undefined,
  });
}

console.log('--- [SignDrop: the verifier] ---');
const signer = makeCert({ cn: 'Ana Firmante', org: 'KaiCorp Labs' });
const p12 = parsePkcs12Bundle(makeP12(signer, 'pw'), 'pw');
const tsaHonest = makeTsa(makeCert({ cn: 'Test TSA', org: 'Relojes SL', keyUsageTimeStamping: true }));
const original = await contract();

console.log('1. A document signed with a certificate and a time-stamp');
const signed = await seal(original, p12, tsaHonest);
ok(signed.isPadesSigned, 'the sealer reports a PAdES signature');
const v1 = await verifyPdfSignatures(signed.sealedBytes);
ok(v1.signatures.length === 1, 'the verifier finds exactly one signature');
const s1 = v1.signatures[0];
ok(s1.valid, `the signature verifies (${s1.reason ?? 'no reason'})`);
ok(s1.signer?.commonName === 'Ana Firmante', 'signed by the certificate\'s common name');
ok(s1.signer?.selfSigned === true, 'and the verifier says the certificate is self-signed');
ok(s1.coversWholeFile, 'the signature covers the whole file');
ok(!v1.modifiedAfterLastSignature, 'nothing appended after it');
ok(s1.certificateValidAtSigning === true, 'the certificate was valid at the claimed signing time');
ok(s1.timestamp !== null, 'an RFC 3161 token is embedded');
ok(s1.timestamp.valid, `the token verifies (${s1.timestamp.reason ?? 'no reason'})`);
ok(s1.timestamp.tsa?.commonName === 'Test TSA', 'and names the TSA that issued it');
ok(typeof s1.timestamp.genTime === 'string' && Math.abs(Date.parse(s1.timestamp.genTime) - Date.now()) < 60_000, 'with the TSA\'s genTime, not the signer\'s clock');

console.log('2. One byte changed inside the signed range');
const tampered = new Uint8Array(signed.sealedBytes);
// A byte inside the first page's content stream: what a tamperer changes.
const streamAt = forge.util.binary.raw.encode(tampered).indexOf('stream\n') + 20;
ok(streamAt > 20 && streamAt < signed.sealedBytes.length, 'the content stream is where a tamperer would look');
tampered[streamAt] ^= 0x01;
const v2 = await verifyPdfSignatures(tampered);
ok(v2.signatures.length === 1 && !v2.signatures[0].valid, 'the signature no longer verifies');
ok(/changed after signing/.test(v2.signatures[0].reason ?? ''), 'and the reason says the bytes changed');

console.log('3. Bytes appended after the signature');
const appended = new Uint8Array(signed.sealedBytes.length + 64);
appended.set(signed.sealedBytes, 0);
appended.set(new TextEncoder().encode('\n%% appended after signing '.padEnd(64, '.')), signed.sealedBytes.length);
const v3 = await verifyPdfSignatures(appended);
ok(v3.signatures[0].valid, 'the signed revision still verifies');
ok(!v3.signatures[0].coversWholeFile && v3.modifiedAfterLastSignature, 'but the verifier reports the file was appended to');

console.log('4. A TSA that time-stamps something else');
const tsaLiar = makeTsa(makeCert({ cn: 'Bad TSA', org: 'Nadie', keyUsageTimeStamping: true }), { lie: true });
const lied = await seal(original, p12, tsaLiar);
const v4 = await verifyPdfSignatures(lied.sealedBytes);
ok(v4.signatures[0].valid, 'the signature itself still verifies');
ok(v4.signatures[0].timestamp && !v4.signatures[0].timestamp.valid, 'the token is rejected');
ok(/imprint/.test(v4.signatures[0].timestamp.reason ?? ''), 'because its imprint is of something else');

console.log('5. Signed without a time-stamp');
const plain = await seal(original, p12, null);
const v5 = await verifyPdfSignatures(plain.sealedBytes);
ok(v5.signatures[0].valid && v5.signatures[0].timestamp === null, 'valid, and honest about having no token');

console.log('6. Stamped without a certificate');
const stampedOnly = await seal(original, null, null);
ok(!stampedOnly.isPadesSigned, 'the sealer does not claim a signature');
const v6 = await verifyPdfSignatures(stampedOnly.sealedBytes);
ok(v6.signatures.length === 0, 'and the verifier finds none to check');

console.log('7. A signature by a key the certificate does not match');
const other = makeCert({ cn: 'Otra', org: 'Otra SL' });
const forged = parsePkcs12Bundle(makeP12({ cert: signer.cert, keys: other.keys }, 'pw'), 'pw');
const forgedDoc = await seal(original, forged, null);
const v7 = await verifyPdfSignatures(forgedDoc.sealedBytes);
ok(!v7.signatures[0].valid && /does not verify with the certificate/.test(v7.signatures[0].reason ?? ''), 'rejected: the signature does not verify with the carried certificate');

console.log(`\n✅ ${checks} checks passed.`);
