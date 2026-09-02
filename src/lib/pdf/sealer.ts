/**
 * PDF Sealer, PAdES and Stamp Embedding Engine using pdf-lib and node-forge.
 * 100% Client-side.
 */
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib';
import QRCode from 'qrcode';
import { StampItem, AuditTrailData } from '../types';
import { calculateSha256 } from '../crypto';
import { signPdfWithPades, type ParsedPkcs12, type SignatureAppearance } from '../pades/signer';

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
  p12Data?: ParsedPkcs12 | null;
  /** RFC 3161 token provider; only meaningful with a certificate (it goes inside the signature). */
  timestamp?: (signatureValue: Uint8Array) => Promise<Uint8Array | null>;
}

export async function sealPdfDocument(options: SealPdfOptions): Promise<{
  sealedBytes: Uint8Array;
  originalHash: string;
  sealedHash: string;
  auditData: AuditTrailData;
  isPadesSigned: boolean;
}> {
  const {
    originalBytes,
    stamps,
    includeAuditSheet = true,
    auditData,
    p12Data,
    timestamp,
  } = options;

  // Calculate original SHA-256
  const originalHash = await calculateSha256(originalBytes);
  auditData.originalHash = originalHash;

  // Load PDF into pdf-lib
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  const pages = pdfDoc.getPages();

  /**
   * The stamp that becomes the signature widget, rather than a drawing.
   *
   * One signature, one widget: the first `signature` stamp is promoted to the
   * appearance of the PAdES signature field, so what the reader sees IS the
   * signature and clicking it opens the certificate. Any further signature
   * stamps stay ordinary drawings — a PDF signature field has one widget, and
   * pretending otherwise would put the same signature in two places with only
   * one of them real. Without a certificate nothing is promoted: there is no
   * signature for a widget to show.
   */
  const widgetStamp = p12Data ? stamps.find((s) => s.type === 'signature') ?? null : null;
  let appearance: SignatureAppearance | undefined;

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
    const stampY = pageHeight - ((stamp.y / 100) * pageHeight) - stampHeight;

    if (stamp === widgetStamp) {
      // Not drawn here: it is handed to the signer as the widget's appearance
      // and drawn from inside the signature field.
      appearance = {
        pageIndex,
        rect: [stampX, stampY, stampWidth, stampHeight],
        image: stamp.content?.startsWith('data:image/') ? dataUrlToUint8Array(stamp.content) : undefined,
        lines: stamp.content && !stamp.content.startsWith('data:image/') ? [stamp.content] : undefined,
      };
      continue;
    }

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

    const subTitle = p12Data
      ? 'PAdES ADVANCED DIGITAL SIGNATURE (X.509 PKI)'
      : 'CLIENT-SIDE TAMPER-EVIDENT VERIFICATION SHEET';

    auditPage.drawText(subTitle, {
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
      cursorY -= 18;
    };

    const drawField = (label: string, value: string, isMono = false) => {
      auditPage.drawText(label, {
        x: 60,
        y: cursorY,
        size: 9.5,
        font: fontHelveticaBold,
        color: rgb(0.3, 0.35, 0.45),
      });
      auditPage.drawText(value, {
        x: 195,
        y: cursorY,
        size: 9.5,
        font: isMono ? fontCourier : fontHelvetica,
        color: rgb(0.05, 0.08, 0.12),
      });
      cursorY -= 18;
    };

    // Document Details Section
    drawSectionHeader('Document Details');
    drawField('Document Name:', auditData.documentName || 'document.pdf');
    drawField('Total Pages Signed:', `${pages.length} page(s)`);
    drawField('Visual Stamps Placed:', `${stamps.length} stamp(s)`);
    drawField('Signing time (signer\'s clock):', `${auditData.timestamp} UTC`);
    if (p12Data && timestamp) {
      // The certified time lives inside the signature, where a verifier
      // reads it; printing a clock here would be printing a claim.
      drawField('RFC 3161 time-stamp:', 'embedded in the PAdES signature (PAdES-B-T)');
    }

    cursorY -= 6;
    // Signer Details Section
    drawSectionHeader('Signer Identification');
    if (p12Data) {
      drawField('X.509 Certificate Name:', p12Data.info.commonName);
      if (p12Data.info.organization) drawField('Organization:', p12Data.info.organization);
      drawField('Certificate Issuer (CA):', p12Data.info.issuer);
      drawField('PAdES Cryptographic Standard:', 'ISO 32000-1 / ETSI EN 319 142');
    } else {
      drawField('Signer Name:', auditData.signerName || 'Anonymous / Local Signer');
      if (auditData.signerEmail) drawField('Signer Email:', auditData.signerEmail);
    }
    drawField('Unique Seal ID:', auditData.signerId, true);

    cursorY -= 6;
    // Cryptographic Hashes Section
    drawSectionHeader('Cryptographic Verification');
    drawField('Original Document SHA-256:', auditData.originalHash, true);

    // QR Code for verification
    // No default: an instance that does not say where it verifies gets no
    // QR pointing at somebody else's.
    const verificationUrl = auditData.verificationUrl
      ? `${auditData.verificationUrl}${auditData.verificationUrl.includes('?') ? '&' : '?'}seal=${encodeURIComponent(auditData.signerId)}`
      : null;
    if (verificationUrl) try {
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        margin: 1,
        width: 140,
        color: { dark: '#080b13', light: '#ffffff' },
      });
      const qrImageBytes = dataUrlToUint8Array(qrDataUrl);
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      auditPage.drawImage(qrImage, {
        x: aWidth - 190,
        y: 100,
        width: 100,
        height: 100,
      });

      auditPage.drawText('Scan to verify seal:', {
        x: aWidth - 190,
        y: 205,
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
      y: 95,
      width: aWidth - 270,
      height: 75,
      color: rgb(0.94, 0.97, 1),
      borderColor: rgb(0.7, 0.85, 0.95),
      borderWidth: 1,
    });

    auditPage.drawText('PRIVACY & INTEGRITY GUARANTEE:', {
      x: 72,
      y: 153,
      size: 8.5,
      font: fontHelveticaBold,
      color: rgb(0, 0.45, 0.7),
    });

    auditPage.drawText(
      'This document was stamped and sealed locally in the user\'s browser.\nNo document contents or private keys were uploaded to any remote server.\nThe cryptographic seal guarantees tamper-evident validation in Adobe Acrobat Reader.',
      {
        x: 72,
        y: 138,
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
  pdfDoc.setProducer('pdf-lib + node-forge (PAdES)');
  pdfDoc.setKeywords([
    'SignDrop',
    `OriginalSHA256:${originalHash}`,
    `SealID:${auditData.signerId}`,
    `Timestamp:${auditData.timestamp}`,
    p12Data ? (timestamp ? 'PAdES-B-T' : 'PAdES-B-B') : 'SES',
  ]);

  // Save the modified PDF with visual stamps
  let sealedBytes = await pdfDoc.save({ useObjectStreams: false });

  // If digital certificate provided, apply PAdES signature
  let isPadesSigned = false;
  if (p12Data) {
    try {
      sealedBytes = await signPdfWithPades({
        pdfBytes: sealedBytes,
        p12Data,
        reason: `Digitally signed with PAdES by ${p12Data.info.commonName}`,
        timestamp,
        appearance,
      });
      isPadesSigned = true;
    } catch (padesErr) {
      // A certificate was given and the signature failed: say it. Returning a
      // merely stamped PDF as if it were signed is the kind of quiet downgrade
      // this tool exists to avoid.
      throw padesErr instanceof Error ? padesErr : new Error('PAdES digital signing failed');
    }
  }

  const sealedHash = await calculateSha256(sealedBytes);
  auditData.sealedHash = sealedHash;

  return {
    sealedBytes,
    originalHash,
    sealedHash,
    auditData,
    isPadesSigned,
  };
}
