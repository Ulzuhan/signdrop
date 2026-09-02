/**
 * Verification of PAdES signatures and RFC 3161 time-stamps, in the browser.
 *
 * This is what makes /verify honest. Before it existed, "valid seal" meant
 * that the PDF's metadata contained the word SignDrop, which anyone can write.
 * Now the page checks the maths: that the bytes covered by each signature's
 * /ByteRange hash to what the signer signed, that the signature verifies with
 * the certificate carried in the CMS, that the certificate was in its validity
 * period at the claimed signing time, whether the signature covers the whole
 * file (a PDF can be appended to after signing), and — when the signature
 * carries an RFC 3161 token — that the token's imprint is the hash of the
 * signature value and that the TSA's own signature verifies.
 *
 * Whether the issuer is a qualified provider is a separate question, answered
 * by `../trust/store` against the EU trusted lists and only when a store is
 * supplied. Without one the report says the maths held and the issuer was not
 * judged — which is a verdict, not a gap.
 *
 * Isomorphic on purpose: node-forge only, so the test suite exercises this
 * exact code in Node.
 */
import forge from 'node-forge';
import { forSignatures, forTimestamps, judgeTrust, type TrustAnchor, type TrustReport, type TrustStoreView } from '../trust/store';

const asn1 = forge.asn1;

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signatureTimeStampToken: '1.2.840.113549.1.9.16.2.14',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha1WithRsa: '1.2.840.113549.1.1.5',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  sha384WithRsa: '1.2.840.113549.1.1.12',
  sha512WithRsa: '1.2.840.113549.1.1.13',
  rsaPss: '1.2.840.113549.1.1.10',
};

const DIGESTS: Record<string, 'sha1' | 'sha256' | 'sha384' | 'sha512'> = {
  [OID.sha1]: 'sha1',
  [OID.sha256]: 'sha256',
  [OID.sha384]: 'sha384',
  [OID.sha512]: 'sha512',
};

const RSA_SIGNATURE_OIDS = new Set([
  OID.rsaEncryption,
  OID.sha1WithRsa,
  OID.sha256WithRsa,
  OID.sha384WithRsa,
  OID.sha512WithRsa,
]);

// ─── Public shapes ───────────────────────────────────────────────────────────

export interface CertificateSummary {
  commonName: string;
  organization: string | null;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
}

export interface TimestampReport {
  /** The imprint matches the signature and the TSA's signature verifies. */
  valid: boolean;
  reason: string | null;
  genTime: string | null;
  tsa: CertificateSummary | null;
  serialNumber: string | null;
  policy: string | null;
  /** Null when no trust store was given. */
  trust: TrustReport | null;
}

export interface SignatureReport {
  index: number;
  /** Digest matches, signature verifies, certificate found. */
  valid: boolean;
  reason: string | null;
  /** Set when the algorithm is one this verifier cannot check. */
  unsupported: string | null;
  digestAlgorithm: string;
  signer: CertificateSummary | null;
  /** Whether the certificate was within its validity period at the claimed signing time. */
  certificateValidAtSigning: boolean | null;
  /** The signing time the signer claimed (a signed attribute), not a certified one. */
  signingTime: string | null;
  byteRange: [number, number, number, number];
  /** The signature covers the file from its first byte to its last. */
  coversWholeFile: boolean;
  timestamp: TimestampReport | null;
  /** Null when no trust store was given. */
  trust: TrustReport | null;
}

/**
 * Given every certificate the PDF's signatures carry, the anchors to judge
 * them against. Asynchronous because the store is thirty files on the origin
 * and the point is to download only the territories this document needs.
 */
export type TrustProvider = (certificates: forge.pki.Certificate[]) => Promise<TrustStoreView>;

export interface VerifyOptions {
  /** Trust anchors to chain certificates to; without them, trust is not judged. */
  anchors?: TrustAnchor[];
  /** The same thing, resolved from the document's own certificates. Wins over `anchors`. */
  trust?: TrustProvider;
}

export interface PdfVerification {
  fileSize: number;
  sha256: string;
  signatures: SignatureReport[];
  /** Some signature is valid but bytes were appended after the last one. */
  modifiedAfterLastSignature: boolean;
}

// ─── Small helpers over forge ────────────────────────────────────────────────

type Node = forge.asn1.Asn1;

function children(node: Node): Node[] {
  return Array.isArray(node.value) ? (node.value as Node[]) : [];
}

function isContext(node: Node, type: number): boolean {
  return node.tagClass === asn1.Class.CONTEXT_SPECIFIC && node.type === type;
}

function oidOf(node: Node): string {
  return asn1.derToOid(node.value as string);
}

function bytesToHex(bytes: Uint8Array): string {
  return forge.util.bytesToHex(forge.util.binary.raw.encode(bytes));
}

function toBinary(bytes: Uint8Array): string {
  return forge.util.binary.raw.encode(bytes);
}

function digestOf(algorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512', parts: string[]): string {
  const md = forge.md[algorithm].create();
  for (const part of parts) md.update(part);
  return md.digest().getBytes();
}

function attributeValue(attrs: Node | null, oid: string): Node | null {
  if (!attrs) return null;
  for (const attr of children(attrs)) {
    const parts = children(attr);
    if (parts.length >= 2 && parts[0].type === asn1.Type.OID && oidOf(parts[0]) === oid) {
      const set = children(parts[1]);
      return set[0] ?? null;
    }
  }
  return null;
}

function timeOf(node: Node): Date | null {
  try {
    if (node.type === asn1.Type.UTCTIME) return asn1.utcTimeToDate(node.value as string);
    if (node.type === asn1.Type.GENERALIZEDTIME) return asn1.generalizedTimeToDate(node.value as string);
  } catch {
    /* fall through */
  }
  return null;
}

function attr(attrs: forge.pki.Certificate['subject']['attributes'], name: string): string {
  const found = attrs.find((a) => a.name === name || a.shortName === name);
  return found ? String(found.value) : '';
}

function summarize(cert: forge.pki.Certificate): CertificateSummary {
  const subjectDer = asn1.toDer(forge.pki.distinguishedNameToAsn1(cert.subject)).getBytes();
  const issuerDer = asn1.toDer(forge.pki.distinguishedNameToAsn1(cert.issuer)).getBytes();
  return {
    commonName: attr(cert.subject.attributes, 'commonName') || '(no common name)',
    organization: attr(cert.subject.attributes, 'organizationName') || null,
    issuer: attr(cert.issuer.attributes, 'commonName') || attr(cert.issuer.attributes, 'organizationName') || '(unknown issuer)',
    serialNumber: cert.serialNumber,
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
    selfSigned: subjectDer === issuerDer,
  };
}

function normalizeSerial(hex: string): string {
  return hex.replace(/^0+/, '').toLowerCase() || '0';
}

// ─── CMS SignedData ──────────────────────────────────────────────────────────

interface ParsedSignedData {
  certificates: forge.pki.Certificate[];
  encapsulatedContent: string | null;
  encapsulatedContentType: string | null;
  signerInfos: Node[];
}

function parseSignedData(contentInfo: Node): ParsedSignedData {
  const ci = children(contentInfo);
  if (ci.length < 2 || oidOf(ci[0]) !== OID.signedData) {
    throw new Error('not a CMS SignedData');
  }
  const signedData = children(ci[1])[0];
  const parts = children(signedData);
  // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
  const encap = children(parts[2]);
  const encapsulatedContentType = encap[0] ? oidOf(encap[0]) : null;
  let encapsulatedContent: string | null = null;
  if (encap[1] && isContext(encap[1], 0)) {
    const inner = children(encap[1])[0];
    if (inner) {
      // The OCTET STRING may itself be constructed (BER); flatten.
      encapsulatedContent = Array.isArray(inner.value)
        ? children(inner).map((n) => n.value as string).join('')
        : (inner.value as string);
    }
  }
  const certificates: forge.pki.Certificate[] = [];
  let signerInfos: Node[] = [];
  for (const part of parts.slice(3)) {
    if (isContext(part, 0)) {
      for (const c of children(part)) {
        try {
          certificates.push(forge.pki.certificateFromAsn1(c));
        } catch {
          // Not an X.509 certificate choice (or a key type forge cannot read): skip.
        }
      }
    } else if (part.tagClass === asn1.Class.UNIVERSAL && part.type === asn1.Type.SET) {
      signerInfos = children(part);
    }
  }
  return { certificates, encapsulatedContent, encapsulatedContentType, signerInfos };
}

interface SignerCheck {
  valid: boolean;
  reason: string | null;
  unsupported: string | null;
  digestAlgorithm: string;
  certificate: forge.pki.Certificate | null;
  signingTime: Date | null;
  signatureValue: string;
  unsignedAttributes: Node | null;
}

/**
 * Checks one SignerInfo against the content it claims to sign. `content` is
 * the binary string the signer's messageDigest must hash to.
 */
function checkSigner(signerInfo: Node, certificates: forge.pki.Certificate[], content: string): SignerCheck {
  const parts = children(signerInfo);
  // version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1] unsignedAttrs?
  const sid = parts[1];
  const digestOid = oidOf(children(parts[2])[0]);
  const algorithm = DIGESTS[digestOid];
  let cursor = 3;
  let signedAttrs: Node | null = null;
  if (parts[cursor] && isContext(parts[cursor], 0)) {
    signedAttrs = parts[cursor];
    cursor++;
  }
  const signatureAlgorithmOid = oidOf(children(parts[cursor])[0]);
  cursor++;
  const signatureValue = parts[cursor].value as string;
  cursor++;
  const unsignedAttributes = parts[cursor] && isContext(parts[cursor], 1) ? parts[cursor] : null;

  const base: SignerCheck = {
    valid: false,
    reason: null,
    unsupported: null,
    digestAlgorithm: algorithm ?? digestOid,
    certificate: null,
    signingTime: null,
    signatureValue,
    unsignedAttributes,
  };

  // The certificate: by issuer and serial number.
  if (sid.tagClass === asn1.Class.UNIVERSAL && sid.type === asn1.Type.SEQUENCE) {
    const [issuerNode, serialNode] = children(sid);
    const issuerDer = asn1.toDer(issuerNode).getBytes();
    const serial = normalizeSerial(forge.util.bytesToHex(serialNode.value as string));
    base.certificate =
      certificates.find(
        (c) =>
          normalizeSerial(c.serialNumber) === serial &&
          asn1.toDer(forge.pki.distinguishedNameToAsn1(c.issuer)).getBytes() === issuerDer
      ) ?? certificates.find((c) => normalizeSerial(c.serialNumber) === serial) ?? null;
  }

  if (!algorithm) {
    base.unsupported = `digest algorithm ${digestOid}`;
    base.reason = 'This verifier does not support the digest algorithm used.';
    return base;
  }
  if (!RSA_SIGNATURE_OIDS.has(signatureAlgorithmOid)) {
    base.unsupported =
      signatureAlgorithmOid === OID.rsaPss ? 'RSA-PSS' : `signature algorithm ${signatureAlgorithmOid}`;
    base.reason = 'This verifier only checks RSA PKCS#1 v1.5 signatures (what .p12 certificates commonly carry).';
    return base;
  }
  if (!base.certificate) {
    base.reason = 'The certificate that signed is not included in the signature.';
    return base;
  }
  if (!signedAttrs) {
    base.reason = 'The signature carries no signed attributes; PAdES requires them.';
    return base;
  }

  const contentDigest = digestOf(algorithm, [content]);
  const claimed = attributeValue(signedAttrs, OID.messageDigest);
  if (!claimed || (claimed.value as string) !== contentDigest) {
    base.reason = 'The signed content does not match what was signed: the bytes changed after signing.';
    return base;
  }

  const signingTimeNode = attributeValue(signedAttrs, OID.signingTime);
  base.signingTime = signingTimeNode ? timeOf(signingTimeNode) : null;

  // The signature is over the DER of the signed attributes as a SET, not as
  // the [0] IMPLICIT tag they travel under.
  const attrsAsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children(signedAttrs));
  const attrsDigest = digestOf(algorithm, [asn1.toDer(attrsAsSet).getBytes()]);
  try {
    const key = base.certificate.publicKey as forge.pki.rsa.PublicKey;
    if (typeof key.verify !== 'function') {
      base.unsupported = 'non-RSA certificate key';
      base.reason = 'The certificate key is not RSA; this verifier cannot check it.';
      return base;
    }
    if (!key.verify(attrsDigest, signatureValue)) {
      base.reason = 'The signature does not verify with the certificate it carries.';
      return base;
    }
  } catch {
    // forge throws when the RSA block decrypted with this key is not a
    // PKCS#1 block at all: that is a signature made with some other key.
    base.reason = 'The signature does not verify with the certificate it carries.';
    return base;
  }

  base.valid = true;
  return base;
}

// ─── RFC 3161 tokens ─────────────────────────────────────────────────────────

export interface TstInfo {
  policy: string;
  imprintAlgorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512' | null;
  imprintHex: string;
  serialNumber: string;
  genTime: Date | null;
}

/** Reads the TSTInfo carried by a TimeStampToken (a CMS ContentInfo). */
export function parseTimeStampToken(token: Node): { tstInfo: TstInfo; signedData: ParsedSignedData } {
  const signedData = parseSignedData(token);
  if (signedData.encapsulatedContentType !== OID.tstInfo || !signedData.encapsulatedContent) {
    throw new Error('not a TimeStampToken');
  }
  const tst = children(asn1.fromDer(signedData.encapsulatedContent));
  // version, policy, messageImprint, serialNumber, genTime, ...
  const imprint = children(tst[2]);
  const imprintOid = oidOf(children(imprint[0])[0]);
  return {
    tstInfo: {
      policy: oidOf(tst[1]),
      imprintAlgorithm: DIGESTS[imprintOid] ?? null,
      imprintHex: forge.util.bytesToHex(imprint[1].value as string),
      serialNumber: forge.util.bytesToHex(tst[3].value as string),
      genTime: timeOf(tst[4]),
    },
    signedData,
  };
}

/** Verifies a TimeStampToken against the signature value it should imprint. */
export function verifyTimeStampToken(token: Node, signatureValue: string, anchors?: TrustStoreView | TrustAnchor[]): TimestampReport {
  let parsed: ReturnType<typeof parseTimeStampToken>;
  try {
    parsed = parseTimeStampToken(token);
  } catch {
    return { valid: false, reason: 'The time-stamp token could not be decoded.', genTime: null, tsa: null, serialNumber: null, policy: null, trust: null };
  }
  const { tstInfo, signedData } = parsed;
  const report: TimestampReport = {
    valid: false,
    reason: null,
    genTime: tstInfo.genTime ? tstInfo.genTime.toISOString() : null,
    tsa: null,
    serialNumber: tstInfo.serialNumber,
    policy: tstInfo.policy,
    trust: null,
  };
  if (!tstInfo.imprintAlgorithm) {
    report.reason = 'The token uses a digest algorithm this verifier does not support.';
    return report;
  }
  const expected = forge.util.bytesToHex(digestOf(tstInfo.imprintAlgorithm, [signatureValue]));
  if (expected !== tstInfo.imprintHex) {
    report.reason = 'The token does not time-stamp this signature: its imprint is of something else.';
    return report;
  }
  const signer = signedData.signerInfos[0];
  if (!signer) {
    report.reason = 'The token carries no TSA signature.';
    return report;
  }
  const check = checkSigner(signer, signedData.certificates, signedData.encapsulatedContent ?? '');
  report.tsa = check.certificate ? summarize(check.certificate) : null;
  if (!check.valid) {
    report.reason = check.reason ?? 'The TSA signature does not verify.';
    return report;
  }
  report.valid = true;
  if (anchors && check.certificate) {
    report.trust = judgeTrust(check.certificate, signedData.certificates, anchors, tstInfo.genTime, forTimestamps);
  }
  return report;
}

// ─── The PDF ─────────────────────────────────────────────────────────────────

interface Located {
  byteRange: [number, number, number, number];
  contentsDer: string;
}

/**
 * Finds every signature in the file by its /ByteRange. The /Contents hex
 * string is exactly the gap between the two ranges, which is more reliable
 * than parsing the dictionary: it is what the signature itself excludes.
 */
function locateSignatures(pdf: string): Located[] {
  const found: Located[] = [];
  const seen = new Set<string>();
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf)) !== null) {
    const byteRange: [number, number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const key = byteRange.join(',');
    if (seen.has(key)) continue;
    const [a, b, c, d] = byteRange;
    if (a + b > c || c + d > pdf.length) continue;
    const gap = pdf.substring(a + b, c).trim();
    if (!gap.startsWith('<') || !gap.endsWith('>')) continue;
    const hex = gap.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length < 2) continue;
    seen.add(key);
    found.push({ byteRange, contentsDer: forge.util.hexToBytes(hex) });
  }
  return found;
}

/**
 * Verifies every signature a PDF carries. Never throws for a malformed
 * signature: it reports it as invalid with the reason.
 */
export async function verifyPdfSignatures(input: ArrayBuffer | Uint8Array, options: VerifyOptions = {}): Promise<PdfVerification> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pdf = toBinary(bytes);
  const sha256 = forge.util.bytesToHex(digestOf('sha256', [pdf]));
  const signatures: SignatureReport[] = [];
  /** What the second pass needs: judging is not possible until every certificate is on the table. */
  const pending: { report: SignatureReport; certificate: forge.pki.Certificate | null; carried: forge.pki.Certificate[]; signingTime: Date | null; token: Node | null; signatureValue: string }[] = [];

  locateSignatures(pdf).forEach((located, index) => {
    const [a, b, c, d] = located.byteRange;
    const covered = pdf.substring(a, a + b) + pdf.substring(c, c + d);
    const coversWholeFile = a === 0 && c + d === pdf.length;
    const report: SignatureReport = {
      index,
      valid: false,
      reason: null,
      unsupported: null,
      digestAlgorithm: '',
      signer: null,
      certificateValidAtSigning: null,
      signingTime: null,
      byteRange: located.byteRange,
      coversWholeFile,
      timestamp: null,
      trust: null,
    };
    try {
      // /Contents is padded with zeros to its reserved size; the DER inside
      // ends where its own length says, and the padding is not ours to parse.
      const contentInfo = (asn1.fromDer as unknown as (b: string, o: object) => Node)(located.contentsDer, {
        strict: false,
        parseAllBytes: false,
      });
      const signedData = parseSignedData(contentInfo);
      const signerInfo = signedData.signerInfos[0];
      if (!signerInfo) throw new Error('no SignerInfo');
      const check = checkSigner(signerInfo, signedData.certificates, covered);
      report.valid = check.valid;
      report.reason = check.reason;
      report.unsupported = check.unsupported;
      report.digestAlgorithm = check.digestAlgorithm;
      report.signer = check.certificate ? summarize(check.certificate) : null;
      report.signingTime = check.signingTime ? check.signingTime.toISOString() : null;
      if (check.certificate && check.signingTime) {
        report.certificateValidAtSigning =
          check.signingTime >= check.certificate.validity.notBefore &&
          check.signingTime <= check.certificate.validity.notAfter;
      }
      const token = attributeValue(check.unsignedAttributes, OID.signatureTimeStampToken);
      if (token) report.timestamp = verifyTimeStampToken(token, check.signatureValue);
      pending.push({
        report,
        certificate: check.certificate,
        carried: signedData.certificates,
        signingTime: check.signingTime,
        token,
        signatureValue: check.signatureValue,
      });
    } catch (error) {
      // A malformed signature is a verdict, not a crash. The detail is kept
      // for whoever is debugging with the environment flag set.
      if (typeof process !== 'undefined' && process.env?.SIGNDROP_VERIFY_DEBUG) console.error('[verify]', error);
      report.reason = report.reason ?? 'The signature could not be decoded as CMS/PKCS#7.';
    }
    signatures.push(report);
  });

  // Second pass. The provider gets every certificate at once so it can work
  // out which territories' lists this document actually needs and fetch those
  // — asking once per signature would download the same file twice.
  const view = options.trust
    ? await options.trust(pending.flatMap((p) => p.carried)).catch(() => null)
    : options.anchors
      ? { anchors: options.anchors }
      : null;
  if (view) {
    for (const item of pending) {
      if (item.certificate) {
        item.report.trust = judgeTrust(item.certificate, item.carried, view, item.signingTime, forSignatures);
      }
      // Re-read the token now that there is a store: parsing a few kilobytes
      // of DER twice is cheaper than threading the TSA's certificate through.
      if (item.token) item.report.timestamp = verifyTimeStampToken(item.token, item.signatureValue, view);
    }
  }

  const last = signatures.reduce<SignatureReport | null>((best, s) => {
    const end = s.byteRange[2] + s.byteRange[3];
    return !best || end > best.byteRange[2] + best.byteRange[3] ? s : best;
  }, null);

  return {
    fileSize: bytes.length,
    sha256,
    signatures,
    modifiedAfterLastSignature: Boolean(last && last.valid && !last.coversWholeFile),
  };
}

/** Builds the unsigned attribute that carries a time-stamp token in a SignerInfo. */
export function signatureTimeStampAttribute(tokenDer: string): Node {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID.signatureTimeStampToken).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [asn1.fromDer(tokenDer)]),
  ]);
}

export const OIDS = OID;
export { bytesToHex };
