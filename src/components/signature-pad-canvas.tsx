'use client';

import React, { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';

interface SignaturePadCanvasProps {
  penColor?: string;
  onEndStroke?: () => void;
  onPadReady?: (pad: SignaturePad) => void;
}

export const SignaturePadCanvas: React.FC<SignaturePadCanvasProps> = ({
  penColor = '#003566',
  onEndStroke,
  onPadReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resize canvas for device pixel ratio
    const resizeCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(ratio, ratio);

      if (padRef.current) {
        padRef.current.clear();
      }
    };

    const pad = new SignaturePad(canvas, {
      penColor: penColor,
      minWidth: 1.5,
      maxWidth: 3.5,
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;

    if (onEndStroke) {
      pad.addEventListener('endStroke', onEndStroke);
    }

    if (onPadReady) {
      onPadReady(pad);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      pad.off();
    };
  }, []);

  useEffect(() => {
    if (padRef.current) {
      padRef.current.penColor = penColor;
    }
  }, [penColor]);

  return (
    <div className="sig-pad-wrapper relative h-56 w-full touch-none bg-white">
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas h-full w-full sd-no-touch"
      />
    </div>
  );
};
