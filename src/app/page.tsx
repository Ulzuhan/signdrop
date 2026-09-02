'use client';

import React, { useState } from 'react';
import { PdfUploader } from '@/components/pdf-uploader';
import { PdfViewer } from '@/components/pdf-viewer';
import { PdfDocumentInfo } from '@/lib/types';
import { Shield, Sparkles, Cpu, Lock, CheckCircle2 } from 'lucide-react';

export default function HomePage() {
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
        <div className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-semibold text-primary shadow-sm" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
          <Sparkles className="size-3.5" />
          Firma de PDFs Zero-Knowledge en tu navegador
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl" style={{ fontFamily: 'var(--kc-font-display)' }}>
          Firma y sella contratos sin exponer tus documentos
        </h1>

        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Subir acuerdos confidenciales o NDAs a plataformas SaaS de terceros expone tus datos.
          Con <strong>SignDrop</strong>, la modificación, estampado visual y sellado SHA-256 se ejecutan <strong>100% en la memoria de tu navegador</strong>.
        </p>
      </div>

      {/* Uploader Box */}
      <PdfUploader onDocumentLoaded={(doc) => setLoadedDoc(doc)} />

      {/* Features Grid */}
      <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
            Privacidad Cero-Servidor
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            El archivo PDF nunca sale de tu equipo. Ni tu firma ni el contenido del documento se envían a ningún servidor remoto.
          </p>
        </div>

        <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Shield className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
            Sello Criptográfico SHA-256
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Genera un certificado de auditoría con huellas criptográficas antes y después de la firma, inalterable y verificable.
          </p>
        </div>

        <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Cpu className="size-5" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
            Múltiples Modos de Firma
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Dibuja en vector suave, escribe con tipografía caligráfica o sube tu firma escaneada con eliminación de fondo transparente.
          </p>
        </div>
      </div>
    </main>
  );
}
