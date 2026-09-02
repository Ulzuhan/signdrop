'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, BookmarkPlus, Layers, Download, Upload, Trash2, Check, FileText } from 'lucide-react';
import { DocumentTemplate } from '@/lib/pades/types';
import { StampItem } from '@/lib/types';
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  exportTemplatesAsJson,
  importTemplatesFromJson,
} from '@/lib/template-store';
import { toast } from 'sonner';

interface TemplateManagerModalProps {
  isOpen: boolean;
  currentStamps: StampItem[];
  onClose: () => void;
  onApplyTemplate: (template: DocumentTemplate) => void;
}

export const TemplateManagerModal: React.FC<TemplateManagerModalProps> = ({
  isOpen,
  currentStamps,
  onClose,
  onApplyTemplate,
}) => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [mode, setMode] = useState<'list' | 'save'>('list');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = () => setTemplates(getTemplates());

  useEffect(() => {
    if (isOpen) reload();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveCurrent = () => {
    if (!newTemplateName.trim()) {
      toast.error('Indica un nombre para la plantilla.');
      return;
    }
    if (currentStamps.length === 0) {
      toast.error('No hay marcas colocadas en el documento actual.');
      return;
    }
    saveTemplate(newTemplateName, newTemplateDesc, currentStamps);
    setNewTemplateName('');
    setNewTemplateDesc('');
    setMode('list');
    reload();
    toast.success('Plantilla guardada correctamente.');
  };

  const handleDelete = (id: string) => {
    deleteTemplate(id);
    reload();
    toast.info('Plantilla eliminada.');
  };

  const handleExport = () => {
    const jsonStr = exportTemplatesAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signdrop_templates_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Plantillas exportadas a JSON.');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const count = importTemplatesFromJson(text);
        reload();
        toast.success(`${count} plantilla(s) importadas con éxito.`);
      } catch (err: any) {
        toast.error(err.message || 'Error al importar archivo JSON');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border bg-card p-6 shadow-2xl"
        style={{
          borderColor: 'var(--kc-line)',
          background: 'var(--kc-panel, #0c1019)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--kc-line)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground" style={{ fontFamily: 'var(--kc-font-display)' }}>
                Plantillas de Disposición Reutilizables
              </h3>
              <p className="text-[11px] text-muted-foreground">Aplica posiciones estándar de firmas y campos con un solo clic</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('list')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'list' ? 'bg-primary text-black' : 'border text-muted-foreground hover:text-white'
              }`}
              style={{ borderColor: 'var(--kc-line)' }}
            >
              Mis Plantillas ({templates.length})
            </button>
            <button
              onClick={() => setMode('save')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'save' ? 'bg-primary text-black' : 'border text-muted-foreground hover:text-white'
              }`}
              style={{ borderColor: 'var(--kc-line)' }}
            >
              <BookmarkPlus className="size-3.5" />
              Guardar actual ({currentStamps.length} marcas)
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleExport}
              title="Exportar a JSON"
              className="flex items-center gap-1 rounded-lg border p-1.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
              style={{ borderColor: 'var(--kc-line)' }}
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Importar de JSON"
              className="flex items-center gap-1 rounded-lg border p-1.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
              style={{ borderColor: 'var(--kc-line)' }}
            >
              <Upload className="size-3.5" />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {mode === 'save' ? (
            <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Nombre de la plantilla:</label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Ej. Contrato de Arrendamiento / NDA Estándar"
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  style={{ borderColor: 'var(--kc-line)' }}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Descripción (Opcional):</label>
                <textarea
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                  placeholder="Notas sobre dónde van las firmas..."
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                  style={{ borderColor: 'var(--kc-line)' }}
                />
              </div>

              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{currentStamps.length} campos</span> serán guardados con sus posiciones relativas.
              </div>

              <button
                type="button"
                onClick={handleSaveCurrent}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-bold text-black hover:opacity-90"
              >
                <Check className="size-4" />
                Guardar Plantilla
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border py-8 text-center" style={{ borderColor: 'var(--kc-line)' }}>
                  <FileText className="size-8 text-muted-foreground opacity-50" />
                  <p className="mt-2 text-xs text-muted-foreground">No tienes plantillas guardadas.</p>
                </div>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between rounded-xl border p-3.5 transition-colors hover:border-primary/40"
                    style={{ borderColor: 'var(--kc-line)', background: 'var(--kc-bg-2, #080b13)' }}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-bold text-foreground">{tpl.name}</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {tpl.fields.length} campos
                        </span>
                      </div>
                      {tpl.description && (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{tpl.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApplyTemplate(tpl);
                          onClose();
                          toast.success(`Plantilla "${tpl.name}" aplicada.`);
                        }}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tpl.id)}
                        className="p-1.5 text-muted-foreground hover:text-red-400"
                        title="Eliminar plantilla"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end border-t pt-4" style={{ borderColor: 'var(--kc-line)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-white"
            style={{ borderColor: 'var(--kc-line)' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
