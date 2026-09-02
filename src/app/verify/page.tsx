'use client';

import React, { useState, useRef } from 'react';
import { ShieldCheck, ShieldAlert, FileSearch, ArrowLeft, Check, Copy, FileText, Lock } from 'lucide-react';
import { inspectSignedPdf } from '@/lib/pdf-engine';
import { formatShortHash } from '@/lib/crypto';
import { toast } from 'sonner';

export default function VerifyPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleProcessFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Por favor, selecciona un documento PDF.');
      return;
    }

    setIsInspecting(true);
    setResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const inspection = await inspectSignedPdf(buffer);
      setResult({
        ...inspection,
        fileName: file.name,
        fileSize: file.size,
      });
      if (inspection.hasAuditSeal) {
        toast.success('Sello de integridad SignDrop detectado.');
      } else {
        toast.info('Documento analizado. No contiene sello SignDrop.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error al inspeccionar el archivo PDF.');
    } finally {
      setIsInspecting(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success('Copiado al portapapeles.');
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        {/* Navigation back */}
        <div className="mb-6">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-3.5" />
            Volver a SignDrop
          </a>
        </div>

        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold text-emerald-400" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
            <ShieldCheck className="size-3.5" />
            Motor de Verificación Criptográfica
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl" style={{ fontFamily: 'var(--kc-font-display)' }}>
            Verificar Autenticidad de Documento
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Arrastra cualquier PDF sellado con SignDrop para comprobar sus huellas criptográficas SHA-256 e información de auditoría.
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleProcessFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-8 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all ${
            isDragging
              ? 'border-emerald-400 bg-emerald-500/5'
              : 'border-[var(--kc-line-2)] bg-[var(--kc-panel,#0c1019)] hover:border-emerald-400/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleProcessFile(file);
            }}
            className="hidden"
          />

          <div className="flex size-14 items-center justify-center rounded-2xl border bg-background/80 text-emerald-400" style={{ borderColor: 'var(--kc-line)' }}>
            <FileSearch className="size-7" />
          </div>

          <p className="mt-4 text-sm font-semibold text-foreground">
            Suelta el archivo PDF aquí o haz clic para examinar
          </p>
          <span className="mt-1 text-xs text-muted-foreground">
            Procesamiento 100% local en tu navegador
          </span>
        </div>

        {isInspecting && (
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Extrayendo metadatos y recalculando SHA-256...
          </div>
        )}

        {/* Inspection Results */}
        {result && (
          <div className="mt-8 space-y-4">
            {result.hasAuditSeal ? (
              <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--kc-ok, #43d787)', background: 'var(--kc-panel, #0c1019)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                    <ShieldCheck className="size-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
                      Sello de Integridad Válido
                    </h3>
                    <p className="text-xs text-emerald-400">
                      El documento contiene un certificado de auditoría SignDrop auténtico.
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-3 divide-y text-xs" style={{ borderColor: 'var(--kc-line)' }}>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-muted-foreground">Nombre de archivo:</span>
                    <span className="font-semibold text-foreground">{result.fileName}</span>
                  </div>

                  {result.sealId && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-muted-foreground">Identificador de Sello:</span>
                      <span className="font-mono text-primary">{result.sealId}</span>
                    </div>
                  )}

                  {result.timestamp && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-muted-foreground">Fecha / Hora de Firma:</span>
                      <span className="font-mono text-foreground">{result.timestamp} UTC</span>
                    </div>
                  )}

                  <div className="pt-2">
                    <span className="text-muted-foreground">Huella SHA-256 Original:</span>
                    <div className="mt-1 flex items-center justify-between rounded-lg border bg-background/50 p-2 font-mono text-[11px] text-foreground" style={{ borderColor: 'var(--kc-line)' }}>
                      <span className="truncate">{result.originalHash}</span>
                      <button
                        onClick={() => handleCopy(result.originalHash, 'orig')}
                        className="ml-2 text-muted-foreground hover:text-white"
                      >
                        {copiedKey === 'orig' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <span className="text-muted-foreground">Huella SHA-256 del PDF actual:</span>
                    <div className="mt-1 flex items-center justify-between rounded-lg border bg-background/50 p-2 font-mono text-[11px] text-emerald-400" style={{ borderColor: 'var(--kc-line)' }}>
                      <span className="truncate">{result.computedHash}</span>
                      <button
                        onClick={() => handleCopy(result.computedHash, 'comp')}
                        className="ml-2 text-muted-foreground hover:text-white"
                      >
                        {copiedKey === 'comp' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--kc-warn, #ffc247)', background: 'var(--kc-panel, #0c1019)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
                    <ShieldAlert className="size-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
                      Sin Sello SignDrop Detectado
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Este PDF no incluye metadatos de sellado o fue firmado con otra herramienta.
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-2 text-xs">
                  <span className="text-muted-foreground">Huella SHA-256 calculada:</span>
                  <div className="mt-1 flex items-center justify-between rounded-lg border bg-background/50 p-2 font-mono text-[11px] text-foreground" style={{ borderColor: 'var(--kc-line)' }}>
                    <span className="truncate">{result.computedHash}</span>
                    <button
                      onClick={() => handleCopy(result.computedHash, 'raw')}
                      className="ml-2 text-muted-foreground hover:text-white"
                    >
                      {copiedKey === 'raw' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
