/**
 * Type definitions for PAdES X.509 signatures, TSA RFC 3161 timestamps and Templates.
 */
import { StampItem } from '../types';

export interface DigitalCertificateInfo {
  commonName: string;
  organization?: string;
  country?: string;
  issuer: string;
  validFrom: string; // ISO string
  validTo: string;   // ISO string
  serialNumber: string;
  isExpired: boolean;
}

export interface TsaTimestampResult {
  tsaName: string;
  timestamp: string; // ISO string UTC
  serialNumber?: string;
  tokenBytesBase64: string;
  status: 'granted' | 'failed';
}

export interface TemplateStampField {
  type: StampItem['type'];
  page: number; // 1-indexed
  x: number;    // percentage 0..100
  y: number;    // percentage 0..100
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  fields: TemplateStampField[];
}
