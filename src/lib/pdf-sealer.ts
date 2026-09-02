/**
 * PDF Sealer and Stamp Embedding Engine using pdf-lib.
 * 100% Client-side.
 */
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib';
import QRCode from 'qrcode';
import { StampItem, AuditTrailData } from './types';
import { calculateSha256 } from './crypto';

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  if (typeof atob !== 'undefined') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Node fallback
  return Buffer.from(base64, 'base64');
}

export interface SealPdfOptions {
  originalBytes: ArrayBuffer | Uint8Array;
  stamps: StampItem[];
  pageDimensions: Array<{ width: number; height: number }>; // in PDF points for each page (0-indexed)
  includeAuditSheet?: boolean;
  auditData: AuditTrailData;
}

export async function sealPdfDocument(options: SealPdfOptions): Promise<{
  sealedBytes: Uint8Array;
  originalHash: string;
  sealedHash: string;
  auditData: AuditTrailData;
}> {
  const { originalBytes, stamps, includeAuditSheet = true, auditData } = options;

  // Calculate original SHA-256
  const originalHash = await calculateSha256(originalBytes);
  auditData.originalHash = originalHash;

  // Load PDF into pdf-lib
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  const pages = pdfDoc.getPages();

  // Apply visual stamps to their respective pages
  for (const stamp of stamps) {
    const pageIndex = stamp.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Map normalized coordinates (0..100 percentage) to PDF point coordinates (Bottom-Left origin)
    const stampX = (stamp.x / 100) * pageWidth;
    const stampWidth = (stamp.width / 100) * pageWidth;
    const stampHeight = (stamp.height / 100) * pageHeight;
    // In PDF coordinates, (0,0) is bottom-left, while in web screen it's top-left:
    const stampY = pageHeight - ((stamp.y / 100) * pageHeight) - stampHeight;

    if (stamp.type === 'signature' || stamp.type === 'initials') {
      if (stamp.content && stamp.content.startsWith('data:image/')) {
        try {
          const imageBytes = dataUrlToUint8Array(stamp.content);
          let embeddedImage;
          if (stamp.content.includes('image/png') || stamp.content.startsWith('data:image/png')) {
            embeddedImage = await pdfDoc.embedPng(imageBytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imageBytes);
          }

          page.drawImage(embeddedImage, {
            x: stampX,
            y: stampY,
            width: stampWidth,
            height: stampHeight,
          });
        } catch (err) {
          console.error('Failed to embed signature image stamp:', err);
        }
      } else if (stamp.content) {
        // Render text-based signature/initials
        page.drawText(stamp.content, {
          x: stampX + 4,
          y: stampY + 4,
          size: stamp.fontSize || 14,
          font: fontHelveticaBold,
          color: rgb(0.06, 0.21, 0.4), // Dark Navy
        });
      }
    } else if (stamp.type === 'text' || stamp.type === 'date') {
      const text = stamp.content || (stamp.type === 'date' ? new Date().toISOString().split('T')[0] : '');
      const fontSize = stamp.fontSize || 12;
      page.drawText(text, {
        x: stampX + 2,
        y: stampY + 4,
        size: fontSize,
        font: fontHelvetica,
        color: rgb(0.08, 0.08, 0.08),
      });
    } else if (stamp.type === 'checkbox') {
      // Draw checkbox box
      page.drawRectangle({
        x: stampX,
        y: stampY,
        width: Math.min(stampWidth, stampHeight),
        height: Math.min(stampWidth, stampHeight),
        borderColor: rgb(0.15, 0.2, 0.3),
        borderWidth: 1.5,
        color: stamp.checked ? rgb(0.9, 0.95, 1) : rgb(1, 1, 1),
      });
      if (stamp.checked) {
        page.drawText('X', {
          x: stampX + 3,
          y: stampY + 2,
          size: Math.min(stampWidth, stampHeight) * 0.8,
          font: fontHelveticaBold,
          color: rgb(0, 0.45, 0.7),
        });
      }
    }
  }

  // Append Audit Certificate Page if enabled
  if (includeAuditSheet) {
    const auditPage = pdfDoc.addPage(PageSizes.A4);
    const { width: aWidth, height: aHeight } = auditPage.getSize();

    // Background header bar
    auditPage.drawRectangle({
      x: 0,
      y: aHeight - 90,
      width: aWidth,
      height: 90,
      color: rgb(0.03, 0.05, 0.1), // #080b13 KaiCorp Dark
    });

    // Header Title
    auditPage.drawText('SignDrop Audit Certificate & Integrity Seal', {
      x: 40,
      y: aHeight - 48,
      size: 18,
      font: fontHelveticaBold,
      color: rgb(0.9, 0.95, 1),
    });

    auditPage.drawText('CLIENT-SIDE TAMPER-EVIDENT VERIFICATION SHEET', {
      x: 40,
      y: aHeight - 68,
      size: 9,
      font: fontCourier,
      color: rgb(0, 0.7, 0.85), // Cyan
    });

    // Content border container
    auditPage.drawRectangle({
      x: 40,
      y: 80,
      width: aWidth - 80,
      height: aHeight - 190,
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
      color: rgb(0.98, 0.99, 1),
    });

    let cursorY = aHeight - 130;

    const drawSectionHeader = (title: string) => {
      auditPage.drawText(title.toUpperCase(), {
        x: 60,
        y: cursorY,
        size: 11,
        font: fontHelveticaBold,
        color: rgb(0.1, 0.2, 0.35),
      });
      cursorY -= 6;
      auditPage.drawLine({
        start: { x: 60, y: cursorY },
        end: { x: aWidth - 60, y: cursorY },
        thickness: 1,
        color: rgb(0.85, 0.88, 0.92),
      });
      cursorY -= 20;
    };

    const drawField = (label: string, value: string, isMono = false) => {
      auditPage.drawText(label, {
        x: 60,
        y: cursorY,
        size: 10,
        font: fontHelveticaBold,
        color: rgb(0.3, 0.35, 0.45),
      });
      auditPage.drawText(value, {
        x: 200,
        y: cursorY,
        size: 10,
        font: isMono ? fontCourier : fontHelvetica,
        color: rgb(0.05, 0.08, 0.12),
      });
      cursorY -= 22;
    };

    // Document Details Section
    drawSectionHeader('Document Details');
    drawField('Document Name:', auditData.documentName || 'document.pdf');
    drawField('Total Pages Signed:', `${pages.length} page(s)`);
    drawField('Visual Stamps Placed:', `${stamps.length} stamp(s)`);
    drawField('Signing Timestamp:', `${auditData.timestamp} UTC`);

    cursorY -= 10;
    // Signer Details Section
    drawSectionHeader('Signer Identification');
    drawField('Signer Name:', auditData.signerName || 'Anonymous / Local Signer');
    if (auditData.signerEmail) {
      drawField('Signer Email:', auditData.signerEmail);
    }
    drawField('Unique Seal ID:', auditData.signerId, true);

    cursorY -= 10;
    // Cryptographic Hashes Section
    drawSectionHeader('Cryptographic Verification');
    drawField('Original Document SHA-256:', auditData.originalHash, true);

    // QR Code for verification
    const verificationUrl = auditData.verificationUrl || `https://sign.kaicorplabs.com/verify?seal=${auditData.signerId}&hash=${originalHash}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        margin: 1,
        width: 140,
        color: { dark: '#080b13', light: '#ffffff' },
      });
      const qrImageBytes = dataUrlToUint8Array(qrDataUrl);
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      auditPage.drawImage(qrImage, {
        x: aWidth - 190,
        y: 110,
        width: 110,
        height: 110,
      });

      auditPage.drawText('Scan to verify seal:', {
        x: aWidth - 190,
        y: 230,
        size: 8,
        font: fontHelveticaBold,
        color: rgb(0.3, 0.35, 0.45),
      });
    } catch (qrErr) {
      console.error('Failed to generate verification QR:', qrErr);
    }

    // Security Notice Box
    auditPage.drawRectangle({
      x: 60,
      y: 100,
      width: aWidth - 280,
      height: 80,
      color: rgb(0.94, 0.97, 1),
      borderColor: rgb(0.7, 0.85, 0.95),
      borderWidth: 1,
    });

    auditPage.drawText('PRIVACY & INTEGRITY GUARANTEE:', {
      x: 72,
      y: 162,
      size: 8.5,
      font: fontHelveticaBold,
      color: rgb(0, 0.45, 0.7),
    });

    auditPage.drawText(
      'This document was stamped and sealed locally in the user\'s browser.\nNo document contents were uploaded to any remote server during signing.\nThe cryptographic SHA-256 seal guarantees tamper-evident validation.',
      {
        x: 72,
        y: 146,
        size: 7.5,
        font: fontHelvetica,
        lineHeight: 11,
        color: rgb(0.15, 0.25, 0.35),
      }
    );

    // Page Footer
    auditPage.drawText('Generated by SignDrop • Built by KaiCorp Labs • sign.kaicorplabs.com', {
      x: 40,
      y: 40,
      size: 8,
      font: fontHelvetica,
      color: rgb(0.5, 0.55, 0.65),
    });
  }

  // Set Document Metadata
  pdfDoc.setTitle(`Signed - ${auditData.documentName}`);
  pdfDoc.setSubject(`SignDrop Cryptographic Seal: ${auditData.signerId}`);
  pdfDoc.setCreator('SignDrop by KaiCorp Labs (Client-side Engine)');
  pdfDoc.setProducer('pdf-lib (WebAssembly/JS)');
  pdfDoc.setKeywords([
    'SignDrop',
    `OriginalSHA256:${originalHash}`,
    `SealID:${auditData.signerId}`,
    `Timestamp:${auditData.timestamp}`,
  ]);

  // Save the modified PDF
  const sealedBytes = await pdfDoc.save();
  const sealedHash = await calculateSha256(sealedBytes);
  auditData.sealedHash = sealedHash;

  return {
    sealedBytes,
    originalHash,
    sealedHash,
    auditData,
  };
}
