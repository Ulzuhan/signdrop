/**
 * Image processing utilities for signature extraction and background removal.
 * Runs in browser canvas memory.
 */

export async function removeSignatureBackground(
  imageDataUrl: string,
  threshold = 200,
  inkColor = '#0f172a'
): Promise<string> {
  if (typeof window === 'undefined') return imageDataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Parse target ink color RGB
      let inkR = 15, inkG = 23, inkB = 42;
      if (inkColor.startsWith('#')) {
        const hex = inkColor.slice(1);
        if (hex.length === 6) {
          inkR = parseInt(hex.substring(0, 2), 16);
          inkG = parseInt(hex.substring(2, 4), 16);
          inkB = parseInt(hex.substring(4, 6), 16);
        }
      }

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a === 0) continue;

        // Perceived luminance
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (lum >= threshold) {
          // Pure white/light background -> make transparent
          data[i + 3] = 0;
        } else {
          // Ink stroke -> calculate opacity based on darkness
          const factor = 1 - (lum / threshold);
          data[i] = inkR;
          data[i + 1] = inkG;
          data[i + 2] = inkB;
          data[i + 3] = Math.min(255, Math.floor(factor * 255 * 1.5));
        }
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => reject(new Error('Failed to load image for processing'));
    img.src = imageDataUrl;
  });
}
