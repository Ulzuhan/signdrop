#!/usr/bin/env node
/**
 * Automated test suite for SignDrop PAdES X.509, TSA RFC 3161 and Templates Engine.
 */
import forge from 'node-forge';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { parsePkcs12Bundle, signPdfWithPades } from '../src/lib/pades-signer.ts';
import { sealPdfDocument } from '../src/lib/pdf-sealer.ts';
import { buildTimeStampRequest } from '../src/lib/tsa-client.ts';
import { saveTemplate, getTemplates, exportTemplatesAsJson, importTemplatesFromJson } from '../src/lib/template-store.ts';
import assert from 'node:assert/strict';

async function generateMockPkcs12(password = 'testpass123') {
  // Generate 1024-bit RSA key for quick test execution
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'Ulzuhan QA Signer' },
    { name: 'countryName', value: 'ES' },
    { name: 'organizationName', value: 'KaiCorp Labs' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    generateLocalKeyId: true,
    friendlyName: 'SignDrop Test Certificate',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  const buffer = new Uint8Array(p12Der.length);
  for (let i = 0; i < p12Der.length; i++) {
    buffer[i] = p12Der.charCodeAt(i);
  }
  return { buffer, cert, privateKey: keys.privateKey };
}

async function runAdvancedTestSuite() {
  console.log('--- [SignDrop Advanced Test Suite: PAdES, TSA & Templates] ---');

  // ── TEST 1: PAdES X.509 PKCS#12 Generation & PDF Signing ──
  console.log('1. Generating synthetic PKCS#12 certificate (.p12)...');
  const { buffer: p12Buffer } = await generateMockPkcs12('testpass123');
  console.log(`   ✓ Mock PKCS#12 bundle created (${p12Buffer.length} bytes)`);

  console.log('2. Parsing PKCS#12 bundle with parsePkcs12Bundle...');
  const parsed = parsePkcs12Bundle(p12Buffer, 'testpass123');
  console.log(`   ✓ Extracted Common Name: "${parsed.info.commonName}"`);
  console.log(`   ✓ Extracted Organization: "${parsed.info.organization}"`);
  console.log(`   ✓ Extracted Issuer: "${parsed.info.issuer}"`);
  assert.equal(parsed.info.commonName, 'Ulzuhan QA Signer');
  assert.equal(parsed.info.organization, 'KaiCorp Labs');
  assert.equal(parsed.info.isExpired, false);

  console.log('3. Sealing PDF with PAdES Digital Signature...');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('CONTRATO FIRMADO DIGITALMENTE (PAdES)', { x: 50, y: 750, size: 14, font });
  const rawPdfBytes = await pdfDoc.save();

  const sealResult = await sealPdfDocument({
    originalBytes: rawPdfBytes,
    stamps: [
      {
        id: 'stamp_1',
        type: 'signature',
        page: 1,
        x: 20,
        y: 80,
        width: 25,
        height: 10,
        content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    ],
    pageDimensions: [{ width: 595, height: 842 }],
    includeAuditSheet: true,
    auditData: {
      documentName: 'contrato_pades.pdf',
      originalHash: '',
      timestamp: '2026-09-02 12:00:00',
      signerName: parsed.info.commonName,
      signerId: 'seal_pades_123',
      stampsCount: 1,
    },
    p12Data: parsed,
    tsaTimestamp: '2026-09-02 12:00:00 UTC',
  });

  assert.equal(sealResult.isPadesSigned, true, 'isPadesSigned must be true');
  const signedPdfStr = forge.util.createBuffer(sealResult.sealedBytes).getBytes();

  assert(signedPdfStr.includes('/Type /Sig') || signedPdfStr.includes('/Type/Sig'), 'Must contain /Type /Sig');
  assert(signedPdfStr.includes('/Filter /Adobe.PPKLite') || signedPdfStr.includes('/Filter/Adobe.PPKLite'), 'Must contain /Adobe.PPKLite');
  assert(signedPdfStr.includes('/SubFilter /adbe.pkcs7.detached') || signedPdfStr.includes('/SubFilter/adbe.pkcs7.detached'), 'Must contain /adbe.pkcs7.detached');
  assert(signedPdfStr.includes('/ByteRange ['), 'Must contain /ByteRange');
  assert(signedPdfStr.includes('/Contents <'), 'Must contain /Contents with signature hex string');

  console.log(`   ✓ PAdES PDF verified (${sealResult.sealedBytes.length} bytes, SHA-256: ${sealResult.sealedHash})`);

  // ── TEST 2: RFC 3161 TSA ASN.1 DER Request ──
  console.log('4. Testing RFC 3161 TimeStampReq ASN.1 binary generation...');
  const testHash = '58d16a0b550095d21d3fc3f72e28979f23f7b53ba010e7c17e1c4f399d28233e';
  const reqBytes = buildTimeStampRequest(testHash);

  assert(reqBytes.length > 40 && reqBytes.length < 200, 'TimeStampReq ASN.1 must be valid length');
  const reqAsn1 = forge.asn1.fromDer(forge.util.createBuffer(reqBytes).getBytes());
  assert.equal(reqAsn1.type, forge.asn1.Type.SEQUENCE, 'TimeStampReq must be an ASN.1 SEQUENCE');
  console.log(`   ✓ TimeStampReq DER encoded successfully (${reqBytes.length} bytes for SHA-256 digest)`);

  // ── TEST 3: Reusable Templates System ──
  console.log('5. Testing Reusable Templates Store...');
  const initialTemplates = getTemplates();
  assert(initialTemplates.length >= 2, 'Default templates should be populated');

  const saved = saveTemplate('Plantilla de Prueba QA', 'Descripción para test', [
    {
      id: 's1',
      type: 'signature',
      page: 1,
      x: 10,
      y: 70,
      width: 20,
      height: 8,
    },
    {
      id: 's2',
      type: 'date',
      page: 1,
      x: 40,
      y: 72,
      width: 15,
      height: 4,
    },
  ]);

  assert.equal(saved.name, 'Plantilla de Prueba QA');
  assert.equal(saved.fields.length, 2);

  const exportedJson = exportTemplatesAsJson();
  assert(exportedJson.includes('Plantilla de Prueba QA'), 'JSON export must include the newly created template');

  const importedCount = importTemplatesFromJson(exportedJson);
  assert(importedCount >= 1, 'Import must process templates from JSON');
  console.log(`   ✓ Template storage, serialization, export and import verified (${saved.fields.length} fields)`);

  console.log('\n✅ ALL PAdES, TSA RFC 3161 AND TEMPLATES TESTS PASSED SUCCESSFULLY.');
}

runAdvancedTestSuite().catch((err) => {
  console.error('\n❌ Advanced Test Suite Failed:', err);
  process.exit(1);
});
