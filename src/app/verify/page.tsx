'use client';

import React, { useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, FileSearch, ArrowLeft, Copy, Check, Clock, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { verifyPdfSignatures, type PdfVerification, type SignatureReport, type CertificateSummary, type TrustAnchor, type TrustReport } from '@/lib/pades/verifier';
import { inspectSignedPdf } from '@/lib/pdf/engine';
import { formatShortHash } from '@/lib/crypto';

/**
 * What this page can and cannot tell you is written on it. It verifies the
 * maths of every PAdES signature in the file and of the RFC 3161 token each
 * carries; it does not decide whether to trust the certificate's issuer,
 * because it has no trust store, and it says so instead of colouring things
 * green. Metadata — SignDrop's keywords, the "original hash" — is shown as
 * what the file claims about itself, never as proof.
 */
interface Result {
  fileName: string;
  fileSize: number;
  verification: PdfVerification;
  metadata: Awaited<ReturnType<typeof inspectSignedPdf>>;
  store: TrustStoreInfo | null;
}

interface TrustStoreInfo {
  tslSequenceNumber: number;
  tslIssued: string;
  retrievedAt: string;
  anchors: number;
}

/**
 * The trust store is ~900 KB of certificates from the Spanish trusted list,
 * fetched from this same origin the first time a file is checked and kept
 * for the page's life. Without it the maths are still checked; only the
 * "who issued this" judgement is left out, and the page says so.
 */
let storePromise: Promise<{ anchors: TrustAnchor[]; info: TrustStoreInfo } | null> | null = null;
function loadTrustStore() {
  if (!storePromise) {
    storePromise = fetch('/trust/es-trusted-list.json')
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return {
          anchors: data.anchors as TrustAnchor[],
          info: { tslSequenceNumber: data.source.tslSequenceNumber, tslIssued: data.source.tslIssued, retrievedAt: data.source.retrievedAt, anchors: data.anchors.length },
        };
      })
      .catch(() => null);
  }
  return storePromise;
}

function Trust({ trust }: { trust: TrustReport | null }) {
  if (!trust) return <p className="text-xs text-muted-foreground">Issuer not judged: the trust list could not be loaded.</p>;
  if (trust.trusted && trust.service) {
    return (
      <p className="text-xs">
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">on the trusted list</span>
        <span className="ms-2 text-foreground">{trust.service.provider}</span>
        <span className="text-muted-foreground"> · {trust.service.service}</span>
      </p>
    );
  }
  return (
    <p className="text-xs">
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">not on the trusted list</span>
      {trust.service && <span className="ms-2 text-foreground">{trust.service.provider}</span>}
      {trust.reason && <span className="ms-2 text-muted-foreground">{trust.reason}</span>}
    </p>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function Certificate({ cert, label }: { cert: CertificateSummary; label: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">
        {cert.commonName}
        {cert.organization ? ` · ${cert.organization}` : ''}
      </dd>
      <dt className="text-muted-foreground">Issued by</dt>
      <dd>
        {cert.issuer}
        {cert.selfSigned && <span className="ms-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">self-signed</span>}
      </dd>
      <dt className="text-muted-foreground">Valid</dt>
      <dd className="tabular-nums">{formatWhen(cert.notBefore)} → {formatWhen(cert.notAfter)}</dd>
      <dt className="text-muted-foreground">Serial</dt>
      <dd className="font-mono break-all">{cert.serialNumber}</dd>
    </dl>
  );
}

function Verdict({ ok, warn, title, detail }: { ok: boolean; warn?: boolean; title: string; detail: string }) {
  const Icon = ok ? ShieldCheck : warn ? ShieldQuestion : ShieldAlert;
  const tone = ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : warn ? 'text-amber-300 border-amber-500/30 bg-amber-500/5' : 'text-red-400 border-red-500/30 bg-red-500/5';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${tone}`}>
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Signature({ s, fileSize }: { s: SignatureReport; fileSize: number }) {
  const covered = s.byteRange[2] + s.byteRange[3];
  return (
    <div className="rounded-2xl border border-[var(--kc-line)] bg-[var(--kc-panel)] p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground">Signature {s.index + 1}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.valid ? 'bg-emerald-500/15 text-emerald-300' : s.unsupported ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>
          {s.valid ? 'verifies' : s.unsupported ? 'cannot check' : 'does not verify'}
        </span>
      </div>

      {s.reason && <p className="mt-2 text-xs text-muted-foreground">{s.reason}</p>}

      <div className="mt-4 space-y-4">
        {s.signer ? (
          <>
            <Certificate cert={s.signer} label="Signed by" />
            <Trust trust={s.trust} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No certificate found in the signature.</p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Signer&apos;s clock</dt>
          <dd className="tabular-nums">
            {formatWhen(s.signingTime)}
            {s.certificateValidAtSigning === false && (
              <span className="ms-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">certificate not valid at that time</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Digest</dt>
          <dd className="font-mono">{s.digestAlgorithm}</dd>
          <dt className="text-muted-foreground">Covers</dt>
          <dd>
            {s.coversWholeFile
              ? 'the whole file, first byte to last'
              : `bytes 0–${covered.toLocaleString()} of ${fileSize.toLocaleString()}: the file was appended to after this signature`}
          </dd>
        </dl>

        <div className="rounded-xl border border-[var(--kc-line)] bg-[var(--kc-bg)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Clock className="size-3.5" aria-hidden />
            RFC 3161 time-stamp
          </p>
          {s.timestamp ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs">
                <span className={s.timestamp.valid ? 'text-emerald-300' : 'text-red-300'}>
                  {s.timestamp.valid ? 'Certified time' : 'Token does not verify'}
                </span>
                {s.timestamp.genTime && <span className="ms-2 tabular-nums text-foreground">{formatWhen(s.timestamp.genTime)}</span>}
              </p>
              {s.timestamp.reason && <p className="text-xs text-muted-foreground">{s.timestamp.reason}</p>}
              {s.timestamp.tsa && <Certificate cert={s.timestamp.tsa} label="Time-stamp authority" />}
              {s.timestamp.tsa && <Trust trust={s.timestamp.trust} />}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">None embedded. The signing time above is the signer&apos;s own clock and proves nothing about when.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const process = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Choose a PDF document.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const store = await loadTrustStore();
      const [verification, metadata] = await Promise.all([
        verifyPdfSignatures(buffer, store ? { anchors: store.anchors } : {}),
        inspectSignedPdf(buffer),
      ]);
      setResult({ fileName: file.name, fileSize: file.size, verification, metadata, store: store?.info ?? null });
    } catch (err) {
      console.error(err);
      toast.error('Could not read this PDF.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const v = result?.verification;
  const validSignatures = v ? v.signatures.filter((s) => s.valid) : [];
  const anyInvalid = v ? v.signatures.some((s) => !s.valid && !s.unsupported) : false;

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-12 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary">
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to SignDrop
          </a>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Verify a signed PDF</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The file is read here, in your browser, and never uploaded. Every PAdES signature is checked against the bytes it
            covers, and every RFC 3161 time-stamp against the signature it certifies.
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void process(f); }}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-8 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-[var(--kc-line)] hover:border-primary/60'}`}
        >
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void process(f); e.target.value = ''; }} className="hidden" />
          <div className="flex size-14 items-center justify-center rounded-2xl border border-[var(--kc-line)] bg-[var(--kc-bg)] text-emerald-400">
            <FileSearch className="size-7" aria-hidden />
          </div>
          <p className="mt-4 text-sm font-semibold text-foreground">Drop a PDF here, or click to choose one</p>
          <span className="mt-1 text-xs text-muted-foreground">Nothing leaves this page.</span>
        </div>

        {busy && (
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Checking signatures…
          </div>
        )}

        {result && v && (
          <div className="mt-8 space-y-4">
            {v.signatures.length === 0 ? (
              <Verdict
                ok={false}
                warn
                title="No digital signature"
                detail={
                  result.metadata.hasAuditSeal
                    ? 'This PDF carries SignDrop stamps and an audit sheet, but no PAdES signature. Stamps alone cannot prove the document was not altered; ask the signer for a copy signed with a certificate.'
                    : 'This PDF carries no PAdES signature and no SignDrop metadata.'
                }
              />
            ) : validSignatures.length > 0 && !anyInvalid ? (
              <Verdict
                ok
                title={v.modifiedAfterLastSignature ? 'Signed, then appended to' : `${validSignatures.length === 1 ? 'The signature verifies' : `All ${validSignatures.length} signatures verify`}`}
                detail={
                  v.modifiedAfterLastSignature
                    ? 'The signed bytes are intact, but data was added to the file after the last signature. Whatever was added is not covered by it.'
                    : validSignatures.every((s) => s.trust?.trusted)
                      ? 'The bytes each signature covers are exactly what was signed, and every certificate chains to a qualified authority on the Spanish trusted list.'
                      : 'The bytes each signature covers are exactly what was signed. Whether to trust who signed is a separate question: see each certificate below.'
                }
              />
            ) : (
              <Verdict
                ok={false}
                title="A signature does not verify"
                detail="Either the file changed after it was signed, or the signature is not what it claims. Do not rely on this document."
              />
            )}

            <div className="rounded-2xl border border-[var(--kc-line)] bg-[var(--kc-panel)] p-5 text-xs">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-medium text-foreground">{result.fileName} · {(result.fileSize / 1024).toFixed(1)} KB</dd>
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="flex items-center gap-2 font-mono">
                  <span title={v.sha256}>{formatShortHash(v.sha256, 12, 12)}</span>
                  <button type="button" onClick={() => copy(v.sha256, 'sha')} className="text-muted-foreground hover:text-foreground" aria-label="Copy SHA-256">
                    {copied === 'sha' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  </button>
                </dd>
                {result.metadata.hasAuditSeal && (
                  <>
                    <dt className="text-muted-foreground">Metadata claims</dt>
                    <dd className="text-muted-foreground">
                      SignDrop seal {result.metadata.sealId ? <span className="font-mono text-foreground">{result.metadata.sealId}</span> : null}
                      {result.metadata.claimedOriginalHash && <> · original SHA-256 <span className="font-mono" title={result.metadata.claimedOriginalHash}>{formatShortHash(result.metadata.claimedOriginalHash, 8, 8)}</span></>}
                      <span className="block">Metadata is written by whoever holds the file; it is not evidence.</span>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {v.signatures.map((s) => (
              <Signature key={s.index} s={s} fileSize={v.fileSize} />
            ))}

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              This verifier checks RSA signatures over SHA-1/256/384/512 and RFC 3161 tokens, and chains certificates to the
              qualified authorities on the Spanish trusted list
              {result.store ? ` (${result.store.anchors} authorities, list ${result.store.tslSequenceNumber} of ${result.store.tslIssued.slice(0, 10)}, fetched ${result.store.retrievedAt.slice(0, 10)})` : ''}.
              It does not check revocation, and reports ECDSA and RSA-PSS signatures as &quot;cannot check&quot;.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
