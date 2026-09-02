/**
 * The CMS SignedData a PAdES signature is made of, assembled by hand.
 *
 * node-forge can build one, and SignDrop used to let it. The problem is
 * where it starts: `pkcs7.sign()` takes the signed content, serialises it to
 * DER, strips the header, and digests it with forge's JavaScript SHA-256. For
 * a 50 MB contract that is three copies of the file in memory and 2.7 seconds
 * of hashing — the whole signature took fifteen seconds, and almost none of
 * it was cryptography.
 *
 * What actually has to be signed is tiny: the SET of signed attributes, a few
 * hundred bytes, one of which is the digest of the document. So the digest is
 * computed once, with WebCrypto where there is one (fifty times faster, and
 * it is the platform's own implementation), and everything else is built
 * here. forge is left doing what only it can do: the RSA operation, and
 * turning a certificate into ASN.1.
 *
 * Isomorphic, like the rest of src/lib: node-forge and WebCrypto only, no DOM.
 */
import forge from 'node-forge';

const asn1 = forge.asn1;
type Node = forge.asn1.Asn1;

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
} as const;

const seq = (value: Node[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, value);
const set = (value: Node[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, value);
const oid = (value: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(value).getBytes());
const octets = (value: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, value);
const integer = (value: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, value);
const nullNode = () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '');
const context = (tag: number, value: Node[]) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, value);

/** AlgorithmIdentifier with an explicit NULL parameter, which is what every reader expects here. */
const algorithm = (id: string) => seq([oid(id), nullNode()]);

/** Attribute ::= SEQUENCE { attrType OID, attrValues SET OF ANY } */
const attribute = (type: string, value: Node) => seq([oid(type), set([value])]);

/**
 * Bytes as the binary string forge works in, in chunks.
 *
 * `forge.util.binary.raw.encode` passes every byte to String.fromCharCode as
 * a separate argument and throws RangeError past about a hundred kilobytes.
 */
export function toBinaryString(bytes: Uint8Array): string {
  const CHUNK = 8192;
  if (bytes.length <= CHUNK) return String.fromCharCode(...bytes);
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) pieces.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return pieces.join('');
}

/**
 * SHA-256 of several byte ranges, as one digest.
 *
 * WebCrypto when the page has it, which is every secure context and Node
 * itself; forge otherwise, so a page served over plain http in development
 * still signs. The two produce the same bytes — they had better.
 */
export async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }
    return new Uint8Array(await subtle.digest('SHA-256', joined));
  }
  const md = forge.md.sha256.create();
  for (const part of parts) md.update(toBinaryString(part));
  const digest = md.digest().getBytes();
  const out = new Uint8Array(digest.length);
  for (let i = 0; i < digest.length; i++) out[i] = digest.charCodeAt(i) & 0xff;
  return out;
}

/** The issuer and serial number that name the signer's certificate in a SignerInfo. */
function issuerAndSerial(certAsn1: Node): Node {
  const tbs = (certAsn1.value as Node[])[0];
  const fields = tbs.value as Node[];
  // TBSCertificate opens with an optional [0] EXPLICIT version; without it
  // everything shifts down one.
  const shift = fields[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 0 : -1;
  return seq([fields[3 + shift], fields[1 + shift]]);
}

export interface BuildSignedDataOptions {
  /** SHA-256 of the bytes the signature covers, already computed. */
  messageDigest: Uint8Array;
  certificate: forge.pki.Certificate;
  /** The chain the .p12 carried, if any. Included so a verifier can build the path. */
  chain: forge.pki.Certificate[];
  privateKey: forge.pki.PrivateKey;
  signingTime: Date;
  /**
   * Asked for an RFC 3161 token over the signature value once it exists. What
   * comes back goes in as the unsigned attribute PAdES-B-T requires. Returning
   * null signs without one; throwing aborts, because a document that claims a
   * time-stamp it does not carry is worse than one that says it has none.
   */
  timestamp?: (signatureValue: Uint8Array) => Promise<Uint8Array | null>;
  /** Builds the unsigned time-stamp attribute. Injected to keep this module free of the verifier. */
  timestampAttribute?: (tokenDer: string) => Node;
}

/**
 * A detached CMS SignedData over `messageDigest`, DER-encoded.
 *
 * "Detached" means the SignedData names the content type and carries no
 * content: the bytes signed are the ones the PDF's /ByteRange points at, and
 * the link between them is the messageDigest attribute.
 */
export async function buildDetachedSignedData(options: BuildSignedDataOptions): Promise<Uint8Array> {
  const { messageDigest, certificate, chain, privateKey, signingTime } = options;

  const certAsn1 = forge.pki.certificateToAsn1(certificate);
  const chainAsn1 = chain.map((c) => forge.pki.certificateToAsn1(c));

  const signedAttrs = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(toBinaryString(messageDigest))),
    attribute(OID.signingTime, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(signingTime))),
  ];

  // What is actually signed: the attributes as a SET, not as the [0] IMPLICIT
  // container they travel in. RFC 5652 §5.4, and getting it wrong is the
  // classic way to produce a signature nothing verifies.
  const attrsForSigning = set(signedAttrs);
  const md = forge.md.sha256.create();
  md.update(asn1.toDer(attrsForSigning).getBytes());
  const signature = (privateKey as forge.pki.rsa.PrivateKey).sign(md, 'RSASSA-PKCS1-V1_5');

  const signerInfo = seq([
    integer(String.fromCharCode(1)), // version 1: the signer is named by issuer and serial
    issuerAndSerial(certAsn1),
    algorithm(OID.sha256),
    context(0, signedAttrs), // [0] IMPLICIT SET OF Attribute
    algorithm(OID.rsaEncryption),
    octets(signature),
  ]);

  // PAdES-B-T: the token imprints the signature value, so it can only be
  // asked for once the signature exists — which is why it is unsigned.
  if (options.timestamp && options.timestampAttribute) {
    const value = new Uint8Array(signature.length);
    for (let i = 0; i < signature.length; i++) value[i] = signature.charCodeAt(i) & 0xff;
    const tokenDer = await options.timestamp(value);
    if (tokenDer) {
      (signerInfo.value as Node[]).push(context(1, [options.timestampAttribute(toBinaryString(tokenDer))]));
    }
  }

  const signedData = seq([
    integer(String.fromCharCode(1)),
    set([algorithm(OID.sha256)]),
    seq([oid(OID.data)]), // encapContentInfo with no eContent: detached
    context(0, [certAsn1, ...chainAsn1]), // [0] IMPLICIT CertificateSet
    set([signerInfo]),
  ]);

  const contentInfo = seq([oid(OID.signedData), context(0, [signedData])]);
  const der = asn1.toDer(contentInfo).getBytes();
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
  return out;
}
