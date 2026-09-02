'use client';

import React, { useState, useRef } from 'react';
import { X, Award, KeyRound, Check, AlertCircle, Trash2, FileKey } from 'lucide-react';
import { parsePkcs12Bundle, ParsedPkcs12 } from '@/lib/pades-signer';
import { toast } from 'sonner';

interface CertificateModalProps {
  isOpen: boolean;
  activeCertificate: ParsedPkcs12 | null;
  onClose: () => void;
  onSelectCertificate: (cert: ParsedPkcs12 | null) => void;
}

export const CertificateModal: React.FC<CertificateModalProps> = ({
  isOpen,
  activeCertificate,
  onClose,
  onSelectCertificate,
}) => {
  const [p12Buffer, setP12Buffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedPkcs12 | null>(activeCertificate);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const buffer = await file.arrayBuffer();
    setP12Buffer(buffer);

    // Try parsing with empty password first
    try {
      const res = parsePkcs12Bundle(buffer, '');
      setParsed(res);
      toast.success('Certificado digital leído correctamente.');
    } catch {
      // Password required
      setParsed(null);
    }
  };

  const handleUnlock = () => {
    if (!p12Buffer) return;
    setIsLoading(true);
    try {
      const res = parsePkcs12Bundle(p12Buffer, password);
      setParsed(res);
      toast.success('Certificado digital desbloqueado con éxito.');
    } catch (err: any) {
      console.error(err);
      toast.error('Contraseña incorrecta o formato de certificado no soportado.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    onSelectCertificate(parsed);
    onClose();
  };

  const handleClear = () => {
    setParsed(null);
    setP12Buffer(null);
    setFileName('');
    setPassword('');
    onSelectCertificate(null);
    toast.info('Certificado digital eliminado de la sesión.');
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
              <Award className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
                Certificado Digital X.509 (PAdES)
              </h3>
              <p className="text-[11px] text-muted-foreground">Firma avanzada reconocida en Adobe Acrobat Reader</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-4">
          {!parsed ? (
            <div>
              <label
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50"
                style={{ borderColor: 'var(--kc-line)' }}
              >
                <FileKey className="size-8 text-primary" />
                <span className="mt-2 text-xs font-semibold text-foreground">
                  {fileName ? `Archivo: ${fileName}` : 'Selecciona tu archivo .p12 o .pfx'}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Procesamiento 100% en memoria de tu navegador (Zero-Knowledge)
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".p12,.pfx"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {p12Buffer && (
                <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}>
                  <label className="text-xs font-semibold text-muted-foreground">Contraseña del certificado:</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                      placeholder="Introduce la clave de cifrado..."
                      className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                      style={{ borderColor: 'var(--kc-line)' }}
                    />
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={handleUnlock}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
                    >
                      <KeyRound className="size-3.5" />
                      Desbloquear
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--kc-ok, #43d787)', background: 'rgba(67, 215, 135, 0.05)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Check className="size-4" />
                    <span className="text-xs font-bold">Certificado Desbloqueado y Listo</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="size-3" />
                    Cambiar
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Titular:</span>
                    <span className="font-semibold text-foreground">{parsed.info.commonName}</span>
                  </div>
                  {parsed.info.organization && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Organización:</span>
                      <span className="text-foreground">{parsed.info.organization}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Emisor CA:</span>
                    <span className="text-foreground">{parsed.info.issuer}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Validez:</span>
                    <span className={parsed.info.isExpired ? 'text-red-400' : 'text-emerald-400'}>
                      Hasta {new Date(parsed.info.validTo).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Número de Serie:</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{parsed.info.serialNumber}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-3 text-[11px] text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
                <p className="flex items-center gap-1.5 text-primary">
                  <Award className="size-3.5" />
                  Modo PAdES Activo:
                </p>
                <p className="mt-1">
                  Al sellar el PDF se incrustará una firma criptográfica estándar PKCS#7 en el `/ByteRange` del documento.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--kc-line)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-white"
            style={{ borderColor: 'var(--kc-line)' }}
          >
            Cerrar
          </button>
          {parsed && (
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              <Check className="size-4" />
              Usar para firmar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
