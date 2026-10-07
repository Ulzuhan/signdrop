export function initializeRevocations(): void;
export function revocationsReady(): boolean;
export function revoke(subject?: string, jti?: string): boolean;
export function revokedAfter(subject: string, issuedAt: number): boolean;
