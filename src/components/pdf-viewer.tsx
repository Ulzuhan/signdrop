'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  PenTool,
  Type,
  Calendar,
  CheckSquare,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  RotateCcw,
  User,
  Plus,
} from 'lucide-react';
import { StampItem, PdfDocumentInfo, AuditTrailData } from '@/lib/types';
import { loadPdfDocument, renderPdfPage } from '@/lib/pdf-engine';
import { sealPdfDocument } from '@/lib/pdf-sealer';
import { generateRandomId } from '@/lib/crypto';
import { StampItemOverlay } from './stamp-item';
import { SignatureModal } from './signature-modal';
import { SealDialog } from './seal-dialog';
import { toast } from 'sonner';

interface PdfViewerProps {
  arrayBuffer: ArrayBuffer;
  documentInfo: PdfDocumentInfo;
  onReset: () => void;
  docDropUrl?: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  arrayBuffer,
  documentInfo,
  onReset,
  docDropUrl,
}) => {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [stamps, setStamps] = useState<StampItem[]>([]);
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 600, height: 800 });

  // Modals state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureModalTitle, setSignatureModalTitle] = useState('Crear firma');
  const [pendingStampType, setPendingStampType] = useState<'signature' | 'initials'>('signature');
  const [isSealDialogOpen, setIsSealDialogOpen] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [sealedPdfBlobUrl, setSealedPdfBlobUrl] = useState<string | undefined>(undefined);
  const [sealedHash, setSealedHash] = useState<string | undefined>(undefined);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Load PDF Document
  useEffect(() => {
    let active = true;
    loadPdfDocument(arrayBuffer)
      .then((loadedPdf) => {
        if (!active) return;
        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
      })
      .catch((err) => {
        console.error('Error loading PDF:', err);
        toast.error('Error al inicializar el visor del PDF');
      });

    return () => {
      active = false;
    };
  }, [arrayBuffer]);

  // Render active page onto canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isRendering = true;
    renderPdfPage(pdfDoc, currentPage, canvasRef.current, scale)
      .then((renderedDim) => {
        if (!isRendering) return;
        setPageSize({ width: renderedDim.width, height: renderedDim.height });
      })
      .catch((err) => {
        if (isRendering) console.error('Error rendering page:', err);
      });

    return () => {
      isRendering = false;
    };
  }, [pdfDoc, currentPage, scale]);

  // Helper to add a new stamp
  const addStamp = (type: StampItem['type'], content?: string) => {
    const newStamp: StampItem = {
      id: generateRandomId(type),
      type,
      page: currentPage,
      x: 35, // centered percentage
      y: 40,
      width: type === 'signature' ? 30 : type === 'initials' ? 18 : type === 'checkbox' ? 6 : 25,
      height: type === 'signature' ? 12 : type === 'initials' ? 10 : type === 'checkbox' ? 5 : 6,
      content,
      fontSize: 14,
      checked: false,
    };

    setStamps((prev) => [...prev, newStamp]);
    setSelectedStampId(newStamp.id);
  };

  const handleOpenSignatureModal = (type: 'signature' | 'initials') => {
    setPendingStampType(type);
    setSignatureModalTitle(type === 'signature' ? 'Crear firma' : 'Crear iniciales');
    setIsSignatureModalOpen(true);
  };

  const handleSaveSignature = (dataUrl: string) => {
    addStamp(pendingStampType, dataUrl);
    toast.success(pendingStampType === 'signature' ? 'Firma añadida al documento.' : 'Iniciales añadidas.');
  };

  const handleUpdateStamp = (id: string, updated: Partial<StampItem>) => {
    setStamps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
  };

  const handleDeleteStamp = (id: string) => {
    setStamps((prev) => prev.filter((s) => s.id !== id));
    if (selectedStampId === id) setSelectedStampId(null);
  };

  const handleDuplicateStamp = (stamp: StampItem) => {
    const duplicated: StampItem = {
      ...stamp,
      id: generateRandomId(stamp.type),
      x: Math.min(80, stamp.x + 4),
      y: Math.min(80, stamp.y + 4),
    };
    setStamps((prev) => [...prev, duplicated]);
    setSelectedStampId(duplicated.id);
  };

  // Perform PDF Sealing
  const handleSealDocument = async ({
    signerName,
    signerEmail,
    includeAuditSheet,
  }: {
    signerName: string;
    signerEmail?: string;
    includeAuditSheet: boolean;
  }) => {
    setIsSealing(true);
    try {
      const auditData: AuditTrailData = {
        documentName: documentInfo.fileName,
        originalHash: documentInfo.originalHash,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        signerName: signerName || 'Usuario Local',
        signerEmail: signerEmail,
        signerId: generateRandomId('seal'),
        stampsCount: stamps.length,
      };

      const result = await sealPdfDocument({
        originalBytes: arrayBuffer,
        stamps,
        pageDimensions: Array.from({ length: numPages }, () => ({ width: 595, height: 842 })),
        includeAuditSheet,
        auditData,
      });

      const blob = new Blob([result.sealedBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setSealedPdfBlobUrl(url);
      setSealedHash(result.sealedHash);
      toast.success('Documento sellado criptográficamente.');
    } catch (err) {
      console.error('Error during sealing:', err);
      toast.error('Error al sellar el PDF.');
    } finally {
      setIsSealing(false);
    }
  };

  const currentStamps = stamps.filter((s) => s.page === currentPage);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top Floating Control Bar */}
      <div
        className="sticky top-14 z-30 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 backdrop-blur"
        style={{
          borderColor: 'var(--kc-line)',
          background: 'color-mix(in oklab, var(--kc-bg) 85%, transparent)',
        }}
      >
        {/* Document Info & Reset */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
            style={{ borderColor: 'var(--kc-line)' }}
            title="Cargar otro documento"
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Cambiar PDF</span>
          </button>
          <span className="max-w-[140px] truncate text-xs font-semibold text-foreground sm:max-w-xs">
            {documentInfo.fileName}
          </span>
        </div>

        {/* Stamps Tools Toolbar */}
        <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
          <button
            type="button"
            onClick={() => handleOpenSignatureModal('signature')}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-black"
          >
            <PenTool className="size-3.5" />
            <span>Firma</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenSignatureModal('initials')}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <User className="size-3.5" />
            <span className="hidden md:inline">Iniciales</span>
          </button>

          <button
            type="button"
            onClick={() => addStamp('text', 'Texto')}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <Type className="size-3.5" />
            <span className="hidden md:inline">Texto</span>
          </button>

          <button
            type="button"
            onClick={() => addStamp('date', new Date().toISOString().split('T')[0])}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <Calendar className="size-3.5" />
            <span className="hidden md:inline">Fecha</span>
          </button>

          <button
            type="button"
            onClick={() => addStamp('checkbox')}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
          >
            <CheckSquare className="size-3.5" />
            <span className="hidden md:inline">Casilla</span>
          </button>
        </div>

        {/* Zoom & Seal Action */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="hidden items-center gap-1 rounded-xl border px-1.5 py-1 sm:flex" style={{ borderColor: 'var(--kc-line)' }}>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, s - 0.2))}
              className="p-1 text-muted-foreground hover:text-white"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="px-1 text-[11px] font-mono text-muted-foreground">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
              className="p-1 text-muted-foreground hover:text-white"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>

          {/* Seal Final Button */}
          <button
            type="button"
            onClick={() => setIsSealDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-black shadow-md transition-opacity hover:opacity-90"
          >
            <ShieldCheck className="size-4" />
            <span>Sellar y Descargar</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Area: Sidebar & PDF Canvas */}
      <div className="flex flex-1 overflow-hidden" style={{ background: 'var(--kc-bg, #05070d)' }}>
        {/* Page Thumbnails Sidebar */}
        {numPages > 1 && (
          <aside
            className="hidden w-28 flex-col items-center gap-3 overflow-y-auto border-r p-3 sm:flex"
            style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}
          >
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Páginas ({numPages})
            </span>
            {Array.from({ length: numPages }).map((_, idx) => {
              const pNum = idx + 1;
              const hasStamps = stamps.some((s) => s.page === pNum);
              return (
                <button
                  key={pNum}
                  type="button"
                  onClick={() => setCurrentPage(pNum)}
                  className={`group relative flex w-full flex-col items-center rounded-xl border p-2 transition-all ${
                    currentPage === pNum
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-[var(--kc-line)] bg-background/50 hover:border-muted-foreground/30'
                  }`}
                >
                  <span className="text-[11px] font-medium text-foreground">Pág. {pNum}</span>
                  {hasStamps && (
                    <span className="mt-1 flex items-center gap-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                      {stamps.filter((s) => s.page === pNum).length} marcas
                    </span>
                  )}
                </button>
              );
            })}
          </aside>
        )}

        {/* Central PDF Canvas Viewport */}
        <main
          className="flex flex-1 flex-col items-center justify-start overflow-auto p-4 sm:p-8"
          onClick={() => setSelectedStampId(null)}
        >
          {/* Pagination bar */}
          <div className="mb-4 flex items-center gap-3 rounded-full border px-4 py-1.5 shadow-sm" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-panel, #0c1019)' }}>
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 text-muted-foreground hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs font-semibold text-foreground">
              Página {currentPage} de {numPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= numPages}
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              className="p-1 text-muted-foreground hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Page Container */}
          <div className="sig-page-wrapper relative">
            <canvas ref={canvasRef} className="block" />
            
            {/* Interactive Overlay Layer */}
            <div
              ref={overlayRef}
              className="sig-overlay-layer"
              style={{
                width: `${pageSize.width}px`,
                height: `${pageSize.height}px`,
              }}
            >
              {currentStamps.map((stamp) => (
                <StampItemOverlay
                  key={stamp.id}
                  stamp={stamp}
                  isSelected={selectedStampId === stamp.id}
                  containerWidth={pageSize.width}
                  containerHeight={pageSize.height}
                  onSelect={() => setSelectedStampId(stamp.id)}
                  onChange={(updated) => handleUpdateStamp(stamp.id, updated)}
                  onDelete={() => handleDeleteStamp(stamp.id)}
                  onDuplicate={() => handleDuplicateStamp(stamp)}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* Modals */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        title={signatureModalTitle}
        onClose={() => setIsSignatureModalOpen(false)}
        onSave={handleSaveSignature}
      />

      <SealDialog
        isOpen={isSealDialogOpen}
        isSealing={isSealing}
        originalHash={documentInfo.originalHash}
        sealedHash={sealedHash}
        documentName={documentInfo.fileName}
        sealedPdfBlobUrl={sealedPdfBlobUrl}
        docDropUrl={docDropUrl}
        onClose={() => setIsSealDialogOpen(false)}
        onConfirmSeal={handleSealDocument}
      />
    </div>
  );
};
