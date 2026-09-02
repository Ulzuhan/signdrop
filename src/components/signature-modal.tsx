'use client';

import React, { useState, useRef } from 'react';
import { X, PenTool, Type, Upload, Trash2, Check, Sparkles } from 'lucide-react';
import { SignaturePadCanvas } from './signature-pad-canvas';
import { removeSignatureBackground } from '@/lib/image-filters';
import SignaturePad from 'signature_pad';

interface SignatureModalProps {
  isOpen: boolean;
  title?: string;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

const INK_COLORS = [
  { name: 'Classic blue', value: '#003566', border: '#003566' },
  { name: 'Ink black', value: '#0f172a', border: '#0f172a' },
  { name: 'Navy', value: '#1d3557', border: '#1d3557' },
];

const FONTS = [
  { id: 'font-sig-caveat', name: 'Caveat', sample: 'Elegant hand' },
  { id: 'font-sig-dancing', name: 'Dancing Script', sample: 'Elegant hand' },
  { id: 'font-sig-vibes', name: 'Great Vibes', sample: 'Elegant hand' },
  { id: 'font-sig-trad', name: 'Playwrite', sample: 'Elegant hand' },
];

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  title = 'Create a signature',
  onClose,
  onSave,
}) => {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [inkColor, setInkColor] = useState(INK_COLORS[0].value);
  const [typedText, setTypedText] = useState('');
  const [selectedFont, setSelectedFont] = useState(FONTS[0].id);
  const [uploadedRaw, setUploadedRaw] = useState<string | null>(null);
  const [processedUpload, setProcessedUpload] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(200);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rememberSignature, setRememberSignature] = useState(true);

  const padRef = useRef<SignaturePad | null>(null);

  // Load saved signature on mount
  if (!isOpen) return null;

  const handleClear = () => {
    if (padRef.current) padRef.current.clear();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setUploadedRaw(dataUrl);
      setIsProcessing(true);
      try {
        const cleaned = await removeSignatureBackground(dataUrl, threshold, inkColor);
        setProcessedUpload(cleaned);
      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleThresholdChange = async (val: number) => {
    setThreshold(val);
    if (uploadedRaw) {
      setIsProcessing(true);
      try {
        const cleaned = await removeSignatureBackground(uploadedRaw, val, inkColor);
        setProcessedUpload(cleaned);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const generateTypedSignatureImage = async (): Promise<string> => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The families are self-hosted by next/font under a generated name, so
    // the only way to name one is through the CSS variable it was given.
    // Read off the document, because a canvas has no stylesheet of its own.
    const family = getComputedStyle(document.documentElement).getPropertyValue(`--${selectedFont}`).trim();
    const fontFamily = family ? `${family}, cursive` : 'cursive';

    // A canvas draws with whatever is loaded at that instant, and next/font
    // loads a face only when something uses it. Without this the signature
    // would silently come out in the fallback the first time it is used.
    try {
      await document.fonts.load(`64px ${fontFamily}`, typedText || 'Signature');
    } catch {
      // A browser that cannot report on its fonts still draws with them.
    }

    ctx.font = `64px ${fontFamily}`;
    ctx.fillStyle = inkColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedText || 'Signature', canvas.width / 2, canvas.height / 2);

    return canvas.toDataURL('image/png');
  };

  const handleConfirm = async () => {
    let finalDataUrl = '';

    if (tab === 'draw') {
      if (!padRef.current || padRef.current.isEmpty()) return;
      finalDataUrl = padRef.current.toDataURL('image/png');
    } else if (tab === 'type') {
      if (!typedText.trim()) return;
      finalDataUrl = await generateTypedSignatureImage();
    } else if (tab === 'upload') {
      if (!processedUpload && !uploadedRaw) return;
      finalDataUrl = processedUpload || uploadedRaw || '';
    }

    if (finalDataUrl) {
      if (rememberSignature) {
        try {
          localStorage.setItem('signdrop_saved_signature', finalDataUrl);
        } catch {
          // ignore
        }
      }
      onSave(finalDataUrl);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl sd-panel"

      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b pb-4 sd-line">
          <h3 className="text-lg font-semibold tracking-tight sd-title">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex rounded-xl border p-1 sd-inset">
          <button
            onClick={() => setTab('draw')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all ${
              tab === 'draw'
                ? 'bg-primary text-black font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <PenTool className="size-3.5" />
            Draw
          </button>
          <button
            onClick={() => setTab('type')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all ${
              tab === 'type'
                ? 'bg-primary text-black font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <Type className="size-3.5" />
            Type
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all ${
              tab === 'upload'
                ? 'bg-primary text-black font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <Upload className="size-3.5" />
            Upload
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-4">
          {tab === 'draw' && (
            <div className="space-y-3">
              <SignaturePadCanvas
                penColor={inkColor}
                onPadReady={(pad) => {
                  padRef.current = pad;
                }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Tinta:</span>
                  {INK_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setInkColor(c.value)}
                      className="size-5 rounded-full border transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c.value,
                        borderColor: inkColor === c.value ? 'var(--sig-accent)' : 'transparent',
                        outline: inkColor === c.value ? '2px solid var(--sig-accent)' : 'none',
                      }}
                      title={c.name}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400 sd-line"
                >
                  <Trash2 className="size-3.5" />
                  Limpiar
                </button>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tu nombre o iniciales:</label>
                <input
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  placeholder="e.g. Carmen García"
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary sd-line"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {FONTS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => setSelectedFont(font.id)}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all ${
                      selectedFont === font.id
                        ? 'border-primary bg-primary/10'
                        : 'border-[var(--kc-line)] bg-background/50 hover:border-muted-foreground/40'
                    }`}
                  >
                    <span className="text-[10px] text-muted-foreground">{font.name}</span>
                    <span className={`mt-1 text-xl ${font.id}`} style={{ color: inkColor }}>
                      {typedText || font.sample}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors hover:border-primary/50 sd-line">
                <Upload className="size-8 text-muted-foreground" />
                <span className="mt-2 text-xs font-medium text-foreground">
                  Selecciona una foto o escaneo de tu firma
                </span>
                <span className="text-[11px] text-muted-foreground">PNG, JPG o WEBP</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {uploadedRaw && (
                <div className="rounded-xl border p-3 sd-line">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="size-3.5 text-primary" />
                      Filtro de transparencia (eliminar fondo blanco):
                    </span>
                    <span>{threshold}</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="250"
                    value={threshold}
                    onChange={(e) => handleThresholdChange(Number(e.target.value))}
                    className="mt-2 w-full accent-primary"
                  />
                  {processedUpload && (
                    <div className="mt-3 flex h-24 items-center justify-center rounded-lg border bg-[repeating-conic-gradient(#1a202c_0%_25%,#10151f_0%_50%)] bg-[length:16px_16px] p-2 sd-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={processedUpload}
                        alt="Transparent preview"
                        className="max-h-full object-contain"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-between border-t pt-4 sd-line">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberSignature}
              onChange={(e) => setRememberSignature(e.target.checked)}
              className="rounded accent-primary"
            />
            Recordar firma en este navegador
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-white sd-line"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isProcessing}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-4" />
              {isProcessing ? 'Working…' : 'Use this signature'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
