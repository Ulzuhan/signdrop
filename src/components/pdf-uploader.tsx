'use client';

import React, { useState, useRef } from 'react';
import { FileUp, ShieldCheck, Lock, FileText, ArrowRight } from 'lucide-react';
import { calculateSha256 } from '@/lib/crypto';
import { PdfDocumentInfo } from '@/lib/types';
import { toast } from 'sonner';

interface PdfUploaderProps {
  onDocumentLoaded: (data: {
    arrayBuffer: ArrayBuffer;
    info: PdfDocumentInfo;
  }) => void;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({ onDocumentLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Choose a PDF.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      toast.error('Over 100 MB: this browser may struggle to work on it.');
      return;
    }

    setIsProcessing(true);
    try {
      const buffer = await file.arrayBuffer();
      const hash = await calculateSha256(buffer);

      const info: PdfDocumentInfo = {
        fileName: file.name,
        fileSize: file.size,
        numPages: 0, // will be populated by viewer
        originalHash: hash,
      };

      onDocumentLoaded({ arrayBuffer: buffer, info });
      toast.success('Loaded. It stayed in this browser.');
    } catch (err) {
      console.error(err);
      toast.error('That PDF could not be read.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="mx-auto w-full max-w-2xl py-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition-all sm:p-14 ${
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-[var(--kc-line-2)] bg-[var(--kc-panel,#0c1019)] hover:border-primary/50 hover:bg-[var(--kc-panel-2,#10151f)]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
          className="hidden"
        />

        {/* Halo Glow */}
        <div className="absolute -top-12 size-36 rounded-full bg-primary/10 blur-3xl transition-opacity group-hover:opacity-100" />

        <div className="relative flex size-20 items-center justify-center rounded-2xl border bg-background/80 shadow-lg sd-line">
          <FileUp className="size-10 text-primary transition-transform duration-300 group-hover:-translate-y-1" />
        </div>

        <h2 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl sd-display">
          Drop a PDF here, or click to choose one
        </h2>

        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Sign it, initial it, date it, and seal it with a SHA-256 audit sheet anybody can check.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground sd-line">
            <Lock className="size-3 text-primary" />
            Opened in this browser, never uploaded
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground sd-line">
            <ShieldCheck className="size-3 text-emerald-400" />
            SHA-256 audit seal
          </span>
        </div>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs font-medium text-white">Hashing it and getting the canvas ready…</span>
            </div>
          </div>
        )}
      </div>

      {/* Verification Direct Link Banner */}
      <div className="mt-6 flex items-center justify-between rounded-2xl border p-4 sd-inset">
        <div className="flex items-center gap-3">
          <FileText className="size-5 text-muted-foreground" />
          <div className="text-left">
            <p className="text-xs font-semibold text-foreground">Already have a signed document?</p>
            <p className="text-[11px] text-muted-foreground">Check its signatures, its time-stamp and who issued the certificate. No account needed.</p>
          </div>
        </div>
        <a
          href="/verify"
          className="flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 sd-line-2"
        >
          Verificar PDF
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
};
