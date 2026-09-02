/**
 * Template management store for reusable stamp field layouts.
 * Persisted in browser localStorage with JSON export/import.
 */
import { DocumentTemplate, TemplateStampField } from './pades/types';
import { StampItem } from './types';
import { generateRandomId } from './crypto';

const STORAGE_KEY = 'signdrop_templates';

const DEFAULT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'tpl_contrato_std',
    name: 'Contrato Estándar (Firma + Fecha)',
    description: 'Disposición típica al pie de página con bloque de firma, nombre completo y fecha.',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    fields: [
      { type: 'signature', page: 1, x: 15, y: 78, width: 30, height: 10, label: 'Firma Principal' },
      { type: 'text', page: 1, x: 15, y: 89, width: 30, height: 4, label: 'Nombre del Firmante' },
      { type: 'date', page: 1, x: 60, y: 78, width: 25, height: 5, label: 'Fecha' },
    ],
  },
  {
    id: 'tpl_nda_completo',
    name: 'Acuerdo de Confidencialidad (NDA)',
    description: 'Iniciales en el lateral y firma con casilla de aceptación al final.',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    fields: [
      { type: 'initials', page: 1, x: 88, y: 92, width: 10, height: 6, label: 'Iniciales' },
      { type: 'checkbox', page: 1, x: 12, y: 72, width: 5, height: 4, label: 'Acepto términos' },
      { type: 'signature', page: 1, x: 20, y: 78, width: 28, height: 10, label: 'Firma' },
      { type: 'date', page: 1, x: 60, y: 78, width: 25, height: 5, label: 'Fecha' },
    ],
  },
];

let inMemoryTemplates: DocumentTemplate[] = [...DEFAULT_TEMPLATES];

export function getTemplates(): DocumentTemplate[] {
  if (typeof window === 'undefined') return inMemoryTemplates;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TEMPLATES));
      return DEFAULT_TEMPLATES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

export function saveTemplate(name: string, description: string, stamps: StampItem[]): DocumentTemplate {
  const current = getTemplates();
  const fields: TemplateStampField[] = stamps.map((s) => ({
    type: s.type,
    page: s.page,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    fontSize: s.fontSize,
  }));

  const newTemplate: DocumentTemplate = {
    id: generateRandomId('tpl'),
    name: name.trim() || 'Nueva Plantilla',
    description: description.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields,
  };

  const updated = [newTemplate, ...current.filter((t) => t.id !== newTemplate.id)];
  inMemoryTemplates = updated;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
  return newTemplate;
}

export function deleteTemplate(id: string): void {
  const current = getTemplates();
  const filtered = current.filter((t) => t.id !== id);
  inMemoryTemplates = filtered;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
}

export function exportTemplatesAsJson(): string {
  const templates = getTemplates();
  return JSON.stringify(templates, null, 2);
}

export function importTemplatesFromJson(jsonStr: string): number {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error('El formato del archivo JSON debe ser una lista de plantillas');

    const current = getTemplates();
    const map = new Map<string, DocumentTemplate>();
    current.forEach((t) => map.set(t.id, t));

    let importedCount = 0;
    for (const t of parsed) {
      if (t.name && Array.isArray(t.fields)) {
        const id = t.id || generateRandomId('tpl');
        map.set(id, {
          id,
          name: String(t.name),
          description: t.description ? String(t.description) : undefined,
          createdAt: t.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          fields: t.fields,
        });
        importedCount++;
      }
    }

    inMemoryTemplates = Array.from(map.values());
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryTemplates));
    }
    return importedCount;
  } catch (err: any) {
    throw new Error(`Error al importar plantillas: ${err.message}`);
  }
}
