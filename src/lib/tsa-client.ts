/**
 * RFC 3161 time-stamping, browser side.
 *
 * The request carries only a digest, never the document. The reply is a
 * TimeStampToken: a CMS SignedData whose content is a TSTInfo with the TSA's
 * own clock (genTime) and the imprint it certified. The token is what gets
 * embedded in the PAdES signature as an unsigned attribute — the earlier
 * version fetched it and then wrote the local clock into the audit sheet,
 * which certified nothing.
 */
import forge from 'node-forge';
import { parseTimeStampToken } from './pades-verifier';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

export interface TimeStampResult {
  /** The token as DER, ready to embed. */
  tokenDer: Uint8Array;
  tokenBytesBase64: string;
  /** What the TSA certified, read from the token itself. */
  genTime: string | null;
  serialNumber: string;
  policy: string;
}

function toUint8(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Encodes an RFC 3161 TimeStampReq (DER) for a SHA-256 imprint. */
export function buildTimeStampRequest(sha256Hex: string): Uint8Array {
  const digestBytes = forge.util.hexToBytes(sha256Hex);
  const nonceHex = forge.util.bytesToHex(forge.random.getBytesSync(8));
  const A = forge.asn1;

  const messageImprint = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
    A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
      A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer(OID_SHA256).getBytes()),
      A.create(A.Class.UNIVERSAL, A.Type.NULL, false, ''),
    ]),
    A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, digestBytes),
  ]);

  const req = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
    A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, forge.util.hexToBytes('01')),
    messageImprint,
    A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, forge.util.hexToBytes(nonceHex)),
    A.create(A.Class.UNIVERSAL, A.Type.BOOLEAN, false, forge.util.hexToBytes('FF')),
  ]);

  return toUint8(A.toDer(req).getBytes());
}

/**
 * Reads a TimeStampResp. Throws when the TSA refused or the reply is not a
 * token; the caller decides whether signing goes on without a time-stamp.
 */
export function parseTimeStampResponse(reply: Uint8Array): TimeStampResult {
  const A = forge.asn1;
  const resp = A.fromDer(forge.util.binary.raw.encode(reply), false);
  const parts = Array.isArray(resp.value) ? (resp.value as forge.asn1.Asn1[]) : [];
  if (parts.length < 1) throw new Error('The TSA reply is not a TimeStampResp');

  // PKIStatusInfo ::= SEQUENCE { status INTEGER, ... }; 0 granted, 1 grantedWithMods.
  const statusInfo = Array.isArray(parts[0].value) ? (parts[0].value as forge.asn1.Asn1[]) : [];
  const status = statusInfo[0] ? A.derToInteger(statusInfo[0].value as string) : -1;
  if (status !== 0 && status !== 1) {
    throw new Error(`The TSA refused the request (status ${status})`);
  }
  if (parts.length < 2) throw new Error('The TSA granted the request but sent no token');

  const token = parts[1];
  const { tstInfo } = parseTimeStampToken(token);
  const tokenDerBinary = A.toDer(token).getBytes();
  return {
    tokenDer: toUint8(tokenDerBinary),
    tokenBytesBase64: forge.util.encode64(tokenDerBinary),
    genTime: tstInfo.genTime ? tstInfo.genTime.toISOString() : null,
    serialNumber: tstInfo.serialNumber,
    policy: tstInfo.policy,
  };
}

/** Requests a token for a SHA-256 imprint through this instance's /api/tsa proxy. */
export async function requestTsaTimestamp(sha256Hex: string): Promise<TimeStampResult> {
  const response = await fetch('/api/tsa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/timestamp-query' },
    body: buildTimeStampRequest(sha256Hex) as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`The time-stamp service answered ${response.status}`);
  }
  return parseTimeStampResponse(new Uint8Array(await response.arrayBuffer()));
}
