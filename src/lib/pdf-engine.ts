/**
 * PDF Viewer & Rendering Engine using pdfjs-dist.
 * Provides client-side rendering into HTML Canvas and metadata extraction.
 */

// Dynamic import helper to safely handle SSR in Next.js
export async function getPdfJs() {
  if (typeof window === 'undefined') {
    throw new Error('pdfjs-dist rendering is only available in browser');
  }
  const pdfjs = await import('pdfjs-dist');
  // Configure worker from CDN or local public asset
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

export async function loadPdfDocument(arrayBuffer: ArrayBuffer) {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/',
    cMapPacked: true,
  });
  return loadingTask.promise;
}

export async function renderPdfPage(
  pdfDoc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5
): Promise<{ width: number; height: number; scale: number }> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // HiDPI / Retina adjustment
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.save();
  ctx.scale(dpr, dpr);

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
  ctx.restore();

  return {
    width: viewport.width,
    height: viewport.height,
    scale,
  };
}

export async function inspectSignedPdf(arrayBuffer: ArrayBuffer) {
  const { PDFDocument } = await import('pdf-lib');
  const { calculateSha256 } = await import('./crypto');

  const computedHash = await calculateSha256(arrayBuffer);
  let originalHash = '';
  let sealId = '';
  let timestamp = '';
  let hasAuditSeal = false;
  let signerName = 'Unknown';
  let title = '';

  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    title = pdfDoc.getTitle() || '';
    const keywords = pdfDoc.getKeywords() || '';
    const subject = pdfDoc.getSubject() || '';

    // Check keywords for SignDrop tags
    if (keywords.includes('SignDrop') || subject.includes('SignDrop') || title.includes('Signed -')) {
      hasAuditSeal = true;
      const matchHash = keywords.match(/OriginalSHA256:([a-fA-F0-9]{64})/);
      if (matchHash) originalHash = matchHash[1];

      const matchSeal = keywords.match(/SealID:([^\s;]+)/);
      if (matchSeal) sealId = matchSeal[1];

      const matchTime = keywords.match(/Timestamp:([^\s;]+)/);
      if (matchTime) timestamp = matchTime[1];
    }
  } catch (err) {
    console.error('Error inspecting PDF metadata:', err);
  }

  return {
    hasAuditSeal,
    isValid: hasAuditSeal && Boolean(originalHash),
    isTampered: false,
    documentName: title.replace('Signed - ', '') || 'document.pdf',
    originalHash: originalHash || computedHash,
    computedHash,
    sealId,
    timestamp,
    signerName,
  };
}
