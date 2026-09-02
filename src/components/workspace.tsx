'use client';

/**
 * The workspace: everything that happens to a document happens here, in this
 * browser. Reached only with a session or a guest link — src/app/page.tsx is
 * the door.
 */

import React, { useState } from 'react';
import { PdfUploader } from '@/components/pdf-uploader';
import { PdfViewer } from '@/components/pdf-viewer';
import { PdfDocumentInfo } from '@/lib/types';
import { Shield, Sparkles, Cpu, Lock, CheckCircle2 } from 'lucide-react';

export function Workspace() {
  const [loadedDoc, setLoadedDoc] = useState<{
    arrayBuffer: ArrayBuffer;
    info: PdfDocumentInfo;
  } | null>(null);

  // No configuration, no button. This is an MIT repository and a default
  // pointing at our own DocDrop would ship our infrastructure to everyone who
  // clones it.
  const docDropUrl = process.env.NEXT_PUBLIC_SIGNDROP_DOCDROP_URL?.trim() || undefined;

  if (loadedDoc) {
    return (
      <PdfViewer
        arrayBuffer={loadedDoc.arrayBuffer}
        documentInfo={loadedDoc.info}
        onReset={() => setLoadedDoc(null)}
        docDropUrl={docDropUrl}
      />
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Hero Title & Description */}
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-semibold text-primary shadow-sm sd-panel">
          <Sparkles className="size-3.5" />
          PDF signing that never leaves your browser
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl sd-display">
          Sign and seal contracts without handing them to anyone
        </h1>

        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Uploading an NDA to somebody else&apos;s platform means they have it. In <strong>SignDrop</strong> the
          stamping, the SHA-256 seal and the PAdES signature all happen <strong>in this browser&apos;s memory</strong> —
          the only thing that ever leaves is a 32-byte hash, and only if you ask for a time-stamp.
        </p>
      </div>

      {/* Uploader Box */}
      <PdfUploader onDocumentLoaded={(doc) => setLoadedDoc(doc)} />

      {/* Features Grid */}
      <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border p-6 sd-panel">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground sd-display">
            The server never sees it
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The PDF is never uploaded. Neither is your certificate: the .p12 is opened in this page&apos;s memory and stays there.
          </p>
        </div>

        <div className="rounded-2xl border p-6 sd-panel">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Shield className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground sd-display">
            A seal anyone can check
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            An audit sheet with the hash before and after signing, and a PAdES signature that Acrobat, pdfsig and /verify all read.
          </p>
        </div>

        <div className="rounded-2xl border p-6 sd-panel">
          <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Cpu className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground sd-display">
            Three ways to sign
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Draw it, type it in one of four hands, or upload a scan and have the background taken out.
          </p>
        </div>
      </div>
    </main>
  );
}
