'use client';

import React, { useState } from 'react';
import { X, ShieldCheck, Download, Send, Check, Copy, ExternalLink } from 'lucide-react';
import { AuditTrailData } from '@/lib/types';
import { toast } from 'sonner';

interface SealDialogProps {
  isOpen: boolean;
  isSealing: boolean;
  originalHash: string;
  sealedHash?: string;
  documentName: string;
  sealedPdfBlobUrl?: string;
  docDropUrl?: string;
  onClose: () => void;
  onConfirmSeal: (data: {
    signerName: string;
    signerEmail?: string;
    includeAuditSheet: boolean;
  }) => void;
}

export const SealDialog: React.FC<SealDialogProps> = ({
  isOpen,
  isSealing,
  originalHash,
  sealedHash,
  documentName,
  sealedPdfBlobUrl,
  docDropUrl = 'https://docdrop.kaicorplabs.com',
  onClose,
  onConfirmSeal,
}) => {
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [includeAuditSheet, setIncludeAuditSheet] = useState(true);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedSealed, setCopiedSealed] = useState(false);

  if (!isOpen) return null;

  const handleCopy = (text: string, type: 'orig' | 'seal') => {
    navigator.clipboard.writeText(text);
    if (type === 'orig') {
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    } else {
      setCopiedSealed(true);
      setTimeout(() => setCopiedSealed(false), 2000);
    }
    toast.success('Hash copiado al portapapeles.');
  };

  const handleDownload = () => {
    if (!sealedPdfBlobUrl) return;
    const a = document.createElement('a');
    a.href = sealedPdfBlobUrl;
    a.download = `Signed_${documentName.replace(/\.pdf$/i, '')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Documento sellado descargado.');
  };

  const handleSendToDocDrop = () => {
    if (!docDropUrl) return;
    window.open(docDropUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl"
        style={{
          borderColor: 'var(--kc-line)',
          background: 'var(--kc-panel, #0c1019)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--kc-line)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <h3 className="text-lg font-bold tracking-tight" style={{ color: 'var(--kc-text-1)', fontFamily: 'var(--kc-font-display)' }}>
              {sealedPdfBlobUrl ? 'Documento Sellado con Éxito' : 'Sellar y Certificar Documento'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {!sealedPdfBlobUrl ? (
          /* Form Configuration Step */
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Nombre del firmante / Organización:</label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Ej. Carmen García o Tu Nombre"
                className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                style={{ borderColor: 'var(--kc-line)' }}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Correo electrónico (Opcional):</label>
              <input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="firmante@empresa.com"
                className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                style={{ borderColor: 'var(--kc-line)' }}
              />
            </div>

            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeAuditSheet}
                  onChange={(e) => setIncludeAuditSheet(e.target.checked)}
                  className="mt-0.5 rounded accent-primary"
                />
                <div>
                  <span className="text-xs font-semibold text-foreground">
                    Añadir Hoja de Certificado de Auditoría
                  </span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Inserta una página final con el sello criptográfico SHA-256, marcas de tiempo UTC y código QR para verificación instantánea.
                  </p>
                </div>
              </label>
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--kc-line)' }}>
              <span className="text-[11px] font-medium text-muted-foreground">Huella SHA-256 del documento original:</span>
              <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-primary">
                <span className="truncate">{originalHash}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(originalHash, 'orig')}
                  className="ml-2 rounded p-1 text-muted-foreground hover:text-white"
                >
                  {copiedOriginal ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                </button>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--kc-line)' }}>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-white"
                style={{ borderColor: 'var(--kc-line)' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSealing}
                onClick={() => onConfirmSeal({ signerName, signerEmail, includeAuditSheet })}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isSealing ? (
                  <>
                    <div className="size-3.5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                    Sellando...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    Sellar documento
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Sealed Result Step */
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--kc-ok, #43d787)', background: 'var(--kc-ok-soft, rgba(67, 215, 135, 0.08))' }}>
              <div className="flex items-center gap-2 text-emerald-400">
                <Check className="size-4 font-bold" />
                <span className="text-xs font-semibold">Integridad criptográfica sellada</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Las firmas y la hoja de auditoría han sido incrustadas localmente en memoria sin tocar ningún servidor externo.
              </p>
            </div>

            {sealedHash && (
              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--kc-line)' }}>
                <span className="text-[11px] font-medium text-muted-foreground">Hash SHA-256 resultante:</span>
                <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-emerald-400">
                  <span className="truncate">{sealedHash}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(sealedHash, 'seal')}
                    className="ml-2 rounded p-1 text-muted-foreground hover:text-white"
                  >
                    {copiedSealed ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-bold text-black transition-transform hover:scale-[1.01]"
              >
                <Download className="size-4" />
                Descargar PDF Sellado
              </button>

              {docDropUrl && (
                <button
                  type="button"
                  onClick={handleSendToDocDrop}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-white"
                  style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}
                >
                  <Send className="size-3.5 text-primary" />
                  Enviar copia cifrada vía DocDrop
                  <ExternalLink className="size-3" />
                </button>
              )}
            </div>

            <div className="border-t pt-3 text-center">
              <a
                href="/verify"
                target="_blank"
                className="text-[11px] text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                Probar la herramienta de verificación de firmas →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
