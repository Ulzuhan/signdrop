export type StampType = 'signature' | 'initials' | 'text' | 'date' | 'checkbox';

export type SignatureMode = 'draw' | 'type' | 'upload';

export interface StampItem {
  id: string;
  type: StampType;
  page: number; // 1-indexed
  // Screen/normalized coordinates on the viewport canvas:
  x: number; // percentage (0..100) or pixels on page
  y: number;
  width: number;
  height: number;
  // Payload:
  content?: string; // Data URL (PNG) for drawn/uploaded signatures, text string for text/date/initials
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  checked?: boolean;
}

export interface PdfDocumentInfo {
  fileName: string;
  fileSize: number;
  numPages: number;
  originalHash: string; // SHA-256 Hex
}

export interface AuditTrailData {
  documentName: string;
  originalHash: string;
  sealedHash?: string;
  timestamp: string; // ISO 8601 UTC
  signerName: string;
  signerEmail?: string;
  signerId: string;
  stampsCount: number;
  verificationUrl?: string;
}

export interface VerificationResult {
  hasAuditSeal: boolean;
  isValid: boolean;
  isTampered: boolean;
  documentName: string;
  originalHash: string;
  embeddedSignedHash?: string;
  computedHash: string;
  timestamp?: string;
  signerName?: string;
  signerEmail?: string;
  signerId?: string;
  stampsCount?: number;
}
