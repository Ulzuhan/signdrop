/**
 * PDF rendering with pdf.js, from this origin and no other.
 *
 * The worker is the code that parses the PDF, and the character maps and
 * standard fonts are data it fetches while doing so. All three used to come
 * from a CDN — cdnjs for the worker, jsDelivr for the maps — which meant that
 * a product whose entire argument is "the document never leaves your machine"
 * was handing the parsing of that document to two third parties on every
 * open. Whoever controls that CDN controls what runs against the contract.
 *
 * The worker is now resolved by the bundler through `new URL(...,
 * import.meta.url)`, so Next emits it as an asset of this build; the maps and
 * fonts are copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs and
 * addressed relative to the page. Nothing here reaches outside the origin,
 * which is also what lets the CSP say `connect-src 'self'` and mean it.
 */

/**
 * pdf.js's own document handle, re-exported under a name this codebase uses.
 *
 * A type-only import, so nothing of pdfjs-dist is pulled into a module that
 * only wanted the shape. It was `any` in four places, which meant the viewer
 * could call anything at all on it and the compiler would agree.
 */
export type { PDFDocumentProxy as PdfJsDocument, PDFPageProxy as PdfJsPage } from 'pdfjs-dist';

/** Where the copied assets live. Relative, so it works behind any host or path. */
const PDFJS_ASSETS = '/pdfjs/';

// Dynamic import helper to safely handle SSR in Next.js
export async function getPdfJs() {
  if (typeof window === 'undefined') {
    throw new Error('pdfjs-dist rendering is only available in browser');
  }
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    try {
      // Bundled: webpack rewrites this to the emitted asset's URL.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    } catch {
      // A build that did not bundle it still has the copy in public/.
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}pdf.worker.min.mjs`;
    }
  }
  return pdfjs;
}

export async function loadPdfDocument(arrayBuffer: ArrayBuffer) {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    /**
     * A copy, and it has to be.
     *
     * pdf.js hands the bytes to its worker by TRANSFERRING them, which
     * detaches the buffer in this thread. The workspace keeps the same
     * ArrayBuffer to seal from later, so sealing died with "Cannot perform
     * Construct on a detached ArrayBuffer" — after the document had been
     * stamped and the certificate unlocked, which is the worst possible
     * moment to lose it. Found by the browser suite; no unit test could see
     * it, because the transfer only happens with a real worker.
     */
    data: new Uint8Array(arrayBuffer.slice(0)),
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
  });
  return loadingTask.promise;
}

export async function renderPdfPage(
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy,
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

/**
 * What the PDF says about itself in its metadata: SignDrop's keywords, the
 * hash of the original it claims, the seal id. None of it is proof of
 * anything — metadata is written by whoever holds the file — and the
 * verification page says so. Proof comes from the PAdES signature
 * (pades/verifier.ts).
 */
export async function inspectSignedPdf(arrayBuffer: ArrayBuffer) {
  const { PDFDocument } = await import('pdf-lib');
  const { calculateSha256 } = await import('../crypto');

  const computedHash = await calculateSha256(arrayBuffer);
  let originalHash = '';
  let sealId = '';
  let timestamp = '';
  let hasAuditSeal = false;
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
    /** SignDrop metadata is present. Says nothing about integrity. */
    hasAuditSeal,
    documentName: title.replace('Signed - ', '') || 'document.pdf',
    /** The original-document hash the metadata claims; empty when absent. */
    claimedOriginalHash: originalHash,
    computedHash,
    sealId,
    claimedTimestamp: timestamp,
  };
}
