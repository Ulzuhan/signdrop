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
      toast.error('Por favor, selecciona un documento en formato PDF válido.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      toast.error('El documento supera el límite recomendado de 100 MB para procesamiento local.');
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
      toast.success('Documento cargado localmente con éxito.');
    } catch (err) {
      console.error(err);
      toast.error('Error al procesar el archivo PDF.');
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

        <div className="relative flex size-20 items-center justify-center rounded-2xl border bg-background/80 shadow-lg" style={{ borderColor: 'var(--kc-line)' }}>
          <FileUp className="size-10 text-primary transition-transform duration-300 group-hover:-translate-y-1" />
        </div>

        <h2 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl" style={{ fontFamily: 'var(--kc-font-display)' }}>
          Arrastra tu PDF aquí o haz clic para seleccionarlo
        </h2>

        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Firma, inicializa, añade fechas y genera sellos criptográficos SHA-256.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
            <Lock className="size-3 text-primary" />
            100% en tu navegador (Zero-Knowledge)
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
            <ShieldCheck className="size-3 text-emerald-400" />
            Sello de Integridad SHA-256
          </span>
        </div>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs font-medium text-white">Calculando hash y preparando lienzo...</span>
            </div>
          </div>
        )}
      </div>

      {/* Verification Direct Link Banner */}
      <div className="mt-6 flex items-center justify-between rounded-2xl border p-4" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2,#080b13)' }}>
        <div className="flex items-center gap-3">
          <FileText className="size-5 text-muted-foreground" />
          <div className="text-left">
            <p className="text-xs font-semibold text-foreground">¿Ya tienes un documento sellado?</p>
            <p className="text-[11px] text-muted-foreground">Comprueba la autenticidad y el hash de cualquier PDF firmado con SignDrop.</p>
          </div>
        </div>
        <a
          href="/verify"
          className="flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          style={{ borderColor: 'var(--kc-line-2)' }}
        >
          Verificar PDF
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
};
