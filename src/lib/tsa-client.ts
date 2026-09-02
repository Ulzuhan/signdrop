/**
 * RFC 3161 Time Stamping Client using ASN.1 DER encoding.
 * 100% Zero-Knowledge: Only the 32-byte SHA-256 digest is transmitted to the TSA.
 */
import forge from 'node-forge';
import { TsaTimestampResult } from './pades-types';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

/**
 * Encodes an RFC 3161 TimeStampReq in binary ASN.1 DER.
 */
export function buildTimeStampRequest(sha256Hex: string): Uint8Array {
  const digestBytes = forge.util.hexToBytes(sha256Hex);
  const nonceBytes = forge.random.getBytesSync(8);
  const nonceHex = forge.util.bytesToHex(nonceBytes);

  // TimeStampReq ::= SEQUENCE  {
  //    version               INTEGER  { v1(1) },
  //    messageImprint        MessageImprint,
  //    reqPolicy             TSAPolicyId              OPTIONAL,
  //    nonce                 INTEGER                  OPTIONAL,
  //    certReq               BOOLEAN                  DEFAULT FALSE,
  //    extensions            [0] IMPLICIT Extensions  OPTIONAL  }
  const messageImprint = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      // AlgorithmIdentifier (SHA-256)
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SEQUENCE,
        true,
        [
          forge.asn1.create(
            forge.asn1.Class.UNIVERSAL,
            forge.asn1.Type.OID,
            false,
            forge.asn1.oidToDer(OID_SHA256).getBytes()
          ),
          forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
        ]
      ),
      // HashedMessage (OCTET STRING)
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, digestBytes),
    ]
  );

  const reqSeq = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      // version = 1
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
      messageImprint,
      // nonce
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes(nonceHex)),
      // certReq = TRUE
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false, forge.util.hexToBytes('FF')),
    ]
  );

  const derStr = forge.asn1.toDer(reqSeq).getBytes();
  const derBytes = new Uint8Array(derStr.length);
  for (let i = 0; i < derStr.length; i++) {
    derBytes[i] = derStr.charCodeAt(i);
  }
  return derBytes;
}

/**
 * Requests an official RFC 3161 Time-Stamp Token via /api/tsa proxy.
 */
export async function requestTsaTimestamp(sha256Hex: string): Promise<TsaTimestampResult> {
  const reqBytes = buildTimeStampRequest(sha256Hex);

  const response = await fetch('/api/tsa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/timestamp-query',
    },
    body: reqBytes as unknown as BodyInit,
  });

  if (!response.ok) {
    throw new Error(`El servidor TSA respondió con estado ${response.status}`);
  }

  const resBuffer = await response.arrayBuffer();
  const resBytes = new Uint8Array(resBuffer);
  const binaryStr = forge.util.createBuffer(resBytes as unknown as forge.util.ArrayBufferView).getBytes();
  const asn1 = forge.asn1.fromDer(binaryStr);

  // TimeStampResp ::= SEQUENCE  {
  //    status                  PKIStatusInfo,
  //    timeStampToken          TimeStampToken     OPTIONAL  }
  if (!asn1.value || !Array.isArray(asn1.value) || asn1.value.length < 2) {
    throw new Error('Respuesta ASN.1 del TSA no válida');
  }

  const pkiStatusInfo = asn1.value[0];
  const statusCode = (pkiStatusInfo.value as any[])?.[0]?.value?.charCodeAt?.(0) ?? 0;

  if (statusCode !== 0 && statusCode !== 1) {
    throw new Error(`TSA rechazó la solicitud de sello de tiempo (código de estado: ${statusCode})`);
  }

  const timeStampToken = asn1.value[1];
  const tokenDer = forge.asn1.toDer(timeStampToken).getBytes();
  const tokenBase64 = forge.util.encode64(tokenDer);

  return {
    tsaName: 'FreeTSA / RFC 3161 Authority',
    timestamp: new Date().toISOString(),
    tokenBytesBase64: tokenBase64,
    status: 'granted',
  };
}
