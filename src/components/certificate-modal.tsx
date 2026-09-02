'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X, Award, KeyRound, Check, Trash2, FileKey } from 'lucide-react';
import { parsePkcs12Bundle, ParsedPkcs12 } from '@/lib/pades/signer';
import { TrustLoader } from '@/lib/trust/loader';
import { forSignatures, judgeTrust, type TrustReport } from '@/lib/trust/store';
import { toast } from 'sonner';

/**
 * The same judgement /verify makes, made here, before anything is signed.
 *
 * Knowing after the fact that your certificate is self-signed is knowing too
 * late: the PDF is out, the other side has it, and it is worth nothing they
 * can rely on. So the certificate is chained against the trusted list of its
 * own country the moment it is unlocked, and the modal says what it found.
 * It never blocks — a self-signed certificate is a legitimate thing to sign
 * with, as long as you know that is what you did.
 */
const trustLoader = new TrustLoader();

interface CertificateModalProps {
  isOpen: boolean;
  activeCertificate: ParsedPkcs12 | null;
  onClose: () => void;
  onSelectCertificate: (cert: ParsedPkcs12 | null) => void;
}

/**
 * What the trusted lists say about this certificate. Three outcomes and never
 * two: listed, not listed, and not judged — the last one when there is no
 * list for the certificate's country or none could be downloaded.
 */
function TrustVerdict({ trust }: { trust: TrustReport | null | 'checking' }) {
  if (trust === 'checking') {
    return (
      <div className="rounded-xl border p-3 text-[11px] text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
        Checking the certificate against the EU trusted lists…
      </div>
    );
  }
  if (!trust) {
    return (
      <div className="rounded-xl border p-3 text-[11px] text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
        <p className="font-semibold text-foreground">Issuer not judged</p>
        <p className="mt-1">No trusted list could be reached, so nothing is claimed about who issued this certificate. The signature will still be cryptographically sound.</p>
      </div>
    );
  }
  if (trust.trusted && trust.service) {
    return (
      <div className="rounded-xl border p-3 text-[11px]" style={{ borderColor: 'var(--kc-ok, #43d787)', background: 'rgba(67, 215, 135, 0.05)' }}>
        <p className="font-semibold text-emerald-400">Qualified certificate, issued by {trust.service.provider}</p>
        <p className="mt-1 text-muted-foreground">
          {trust.service.service}
          {trust.territory ? ` · on the trusted list of ${trust.territory}` : ''}
        </p>
      </div>
    );
  }
  if (!trust.judged) {
    return (
      <div className="rounded-xl border p-3 text-[11px] text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
        <p className="font-semibold text-foreground">Issuer not judged</p>
        <p className="mt-1">{trust.reason}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border p-3 text-[11px]" style={{ borderColor: 'var(--kc-warn, #f2b544)', background: 'rgba(242, 181, 68, 0.05)' }}>
      <p className="font-semibold text-amber-300">Not on any trusted list</p>
      <p className="mt-1 text-muted-foreground">
        {trust.reason} You can sign with it, and the maths will check out — but the signature will not carry the legal weight
        of a qualified one beyond showing the file has not changed.
      </p>
    </div>
  );
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
  const [trust, setTrust] = useState<TrustReport | null | 'checking'>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!parsed) {
      setTrust(null);
      return;
    }
    let current = true;
    setTrust('checking');
    trustLoader
      .view([parsed.cert, ...parsed.caCertificates])
      .then((view) => {
        if (current) setTrust(judgeTrust(parsed.cert, parsed.caCertificates, view, new Date(), forSignatures));
      })
      .catch(() => {
        if (current) setTrust(null);
      });
    return () => {
      current = false;
    };
  }, [parsed]);

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
      toast.success('Certificate read.');
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
      toast.success('Certificate unlocked.');
    } catch (err: any) {
      console.error(err);
      toast.error('Wrong password, or a certificate format this reader does not support.');
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
    toast.info('Certificate dropped from this session.');
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
                X.509 certificate (PAdES)
              </h3>
              <p className="text-[11px] text-muted-foreground">Advanced signature, validated by Adobe Acrobat Reader</p>
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
                  {fileName ? fileName : 'Choose your .p12 or .pfx file'}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Opened in this browser's memory. The file never leaves your machine.
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
                  <label className="text-xs font-semibold text-muted-foreground">Certificate password</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                      placeholder="The password that protects the key"
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
                      Unlock
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
                    <span className="text-xs font-bold">Unlocked and ready to sign</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="size-3" />
                    Change
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Holder</span>
                    <span className="font-semibold text-foreground">{parsed.info.commonName}</span>
                  </div>
                  {parsed.info.organization && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Organisation</span>
                      <span className="text-foreground">{parsed.info.organization}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Issued by</span>
                    <span className="text-foreground">{parsed.info.issuer}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valid</span>
                    <span className={parsed.info.isExpired ? 'text-red-400' : 'text-emerald-400'}>
                      until {new Date(parsed.info.validTo).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Serial number</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{parsed.info.serialNumber}</span>
                  </div>
                </div>
              </div>

              <TrustVerdict trust={trust} />

              <div className="rounded-xl border p-3 text-[11px] text-muted-foreground" style={{ borderColor: 'var(--kc-line)' }}>
                <p className="flex items-center gap-1.5 text-primary">
                  <Award className="size-3.5" />
                  PAdES mode
                </p>
                <p className="mt-1">
                  Sealing embeds a PKCS#7 signature over the document's /ByteRange, which is what Acrobat checks.
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
            Close
          </button>
          {parsed && (
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              <Check className="size-4" />
              Use for signing
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
