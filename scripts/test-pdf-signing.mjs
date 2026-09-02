#!/usr/bin/env node
/**
 * Automated test suite for SignDrop PDF Signing & Integrity Engine.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { sealPdfDocument } from '../src/lib/pdf/sealer.ts';
import { calculateSha256 } from '../src/lib/crypto.ts';
import { inspectSignedPdf } from '../src/lib/pdf/engine.ts';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('--- [SignDrop Test Suite: PDF Engine & Cryptographic Integrity] ---');

  // Step 1: Generate a test PDF
  console.log('1. Creating mock contract PDF...');
  const baseDoc = await PDFDocument.create();
  const page = baseDoc.addPage([595, 842]); // A4
  const font = await baseDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('ACUERDO DE CONFIDENCIALIDAD Y SERVICIOS', {
    x: 50,
    y: 750,
    size: 16,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Este es un documento de prueba para validar la firma client-side.', {
    x: 50,
    y: 710,
    size: 11,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  const originalBytes = await baseDoc.save();
  const originalHash = await calculateSha256(originalBytes);
  console.log(`   ✓ Original PDF created (Size: ${originalBytes.length} bytes, SHA-256: ${originalHash})`);

  // Step 2: Define mock stamps
  console.log('2. Applying visual stamps and audit certificate...');
  // 1x1 transparent dummy PNG data URL
  const dummyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const stamps = [
    {
      id: 'stamp_sig_1',
      type: 'signature',
      page: 1,
      x: 20,
      y: 70,
      width: 25,
      height: 10,
      content: dummyPngDataUrl,
    },
    {
      id: 'stamp_date_1',
      type: 'date',
      page: 1,
      x: 55,
      y: 72,
      width: 20,
      height: 5,
      content: '2026-09-02',
    },
    {
      id: 'stamp_check_1',
      type: 'checkbox',
      page: 1,
      x: 15,
      y: 65,
      width: 5,
      height: 5,
      checked: true,
    },
  ];

  const auditData = {
    documentName: 'contrato_confidencial.pdf',
    originalHash,
    timestamp: '2026-09-02 12:00:00',
    signerName: 'Test Auditor',
    signerEmail: 'auditor@kaicorplabs.com',
    signerId: 'seal_test_998877',
    stampsCount: stamps.length,
    verificationUrl: 'https://sign.kaicorplabs.com/verify?seal=seal_test_998877',
  };

  const sealResult = await sealPdfDocument({
    originalBytes,
    stamps,
    pageDimensions: [{ width: 595, height: 842 }],
    includeAuditSheet: true,
    auditData,
  });

  console.log(`   ✓ Sealed PDF generated (Size: ${sealResult.sealedBytes.length} bytes)`);
  console.log(`   ✓ Original Hash recorded: ${sealResult.originalHash}`);
  console.log(`   ✓ Sealed Hash calculated: ${sealResult.sealedHash}`);

  // Assertions on Sealing
  assert.notEqual(sealResult.originalHash, sealResult.sealedHash, 'Original and Sealed hashes must differ');
  assert.equal(sealResult.originalHash, originalHash, 'Recorded original hash must match raw buffer calculation');

  // Step 3: Inspect the signed PDF metadata and seal
  console.log('3. Inspecting signed PDF with verification engine...');
  const inspection = await inspectSignedPdf(sealResult.sealedBytes);
  console.log(`   ✓ Has Audit Seal: ${inspection.hasAuditSeal}`);
  console.log(`   ✓ Claimed Original SHA-256: ${inspection.claimedOriginalHash}`);
  console.log(`   ✓ Extracted Seal ID: ${inspection.sealId}`);
  console.log(`   ✓ Computed Hash: ${inspection.computedHash}`);

  assert.equal(inspection.hasAuditSeal, true, 'Sealed PDF must contain SignDrop audit seal metadata');
  assert.equal(inspection.claimedOriginalHash, originalHash, 'Metadata inspection must recover the claimed original SHA-256 hash');
  assert.equal(inspection.sealId, 'seal_test_998877', 'Seal ID must match');
  assert.equal(inspection.computedHash, sealResult.sealedHash, 'Computed hash must match sealed output hash');

  // Step 4: Validate tamper-evidence
  console.log('4. Testing tamper-evidence upon byte corruption...');
  const corruptedBytes = new Uint8Array(sealResult.sealedBytes);
  // Modify one byte
  corruptedBytes[corruptedBytes.length - 50] ^= 0xff;
  const corruptedHash = await calculateSha256(corruptedBytes);

  assert.notEqual(corruptedHash, sealResult.sealedHash, 'Modifying a single byte must produce a different hash');
  console.log(`   ✓ Byte modification detected! (Altered Hash: ${corruptedHash})`);

  console.log('\n✅ ALL SIGNDROP ENGINE & CRYPTOGRAPHY TESTS PASSED SUCCESSFULLY.');
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
