import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { OID, buildDetachedSignedData, sha256, toBinaryString } from './cms';

/**
 * The CMS that gets embedded in the PDF, checked as ASN.1 rather than through
 * a document.
 *
 * The behaviour suites verify signatures end to end and pdfsig checks them
 * from outside; what this covers is the shape, which is where a hand-built
 * structure goes wrong quietly. A SignedData with the attributes in the wrong
 * container, or with the digest of the wrong bytes, still parses — it just
 * never verifies, and the failure surfaces three layers away.
 */
const asn1 = forge.asn1;

function makeSigner() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0a0b0c';
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3);
  const attrs = [{ name: 'commonName', value: 'Ana' }, { name: 'countryName', value: 'ES' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

const parse = (der: Uint8Array) => asn1.fromDer(toBinaryString(der));
const children = (node: forge.asn1.Asn1) => node.value as forge.asn1.Asn1[];

describe('the digest', () => {
  it('is the platform\'s, and matches forge over the same bytes', async () => {
    const bytes = new Uint8Array(5000).map((_, i) => i % 251);
    const ours = await sha256([bytes]);
    const theirs = forge.md.sha256.create();
    theirs.update(toBinaryString(bytes));
    expect(forge.util.bytesToHex(toBinaryString(ours))).toBe(theirs.digest().toHex());
  });

  it('concatenates the ranges rather than digesting them one by one', async () => {
    const whole = await sha256([Uint8Array.from([1, 2, 3, 4])]);
    const split = await sha256([Uint8Array.from([1, 2]), Uint8Array.from([3, 4])]);
    expect([...split]).toEqual([...whole]);
  });
});

describe('the structure', () => {
  it('is a ContentInfo of signedData carrying no content: detached', async () => {
    const { cert, key } = makeSigner();
    const der = await buildDetachedSignedData({
      messageDigest: await sha256([Uint8Array.from([1, 2, 3])]),
      certificate: cert,
      chain: [],
      privateKey: key,
      signingTime: new Date(),
    });

    const contentInfo = parse(der);
    expect(asn1.derToOid(children(contentInfo)[0].value as string)).toBe(OID.signedData);

    const signedData = children(children(contentInfo)[1])[0];
    const [, digestAlgorithms, encap, certs, signerInfos] = children(signedData);
    expect(asn1.derToOid(children(children(digestAlgorithms)[0])[0].value as string)).toBe(OID.sha256);
    // encapContentInfo with the type and nothing else: the bytes signed are
    // the PDF's, and they are not in here.
    expect(children(encap)).toHaveLength(1);
    expect(asn1.derToOid(children(encap)[0].value as string)).toBe(OID.data);
    expect(children(certs)).toHaveLength(1);
    expect(children(signerInfos)).toHaveLength(1);
  });

  it('carries the chain the .p12 came with, so a verifier can build the path', async () => {
    const { cert, key } = makeSigner();
    const ca = makeSigner().cert;
    const der = await buildDetachedSignedData({
      messageDigest: await sha256([Uint8Array.from([1])]),
      certificate: cert,
      chain: [ca],
      privateKey: key,
      signingTime: new Date(),
    });
    const signedData = children(children(parse(der))[1])[0];
    expect(children(children(signedData)[3])).toHaveLength(2);
  });

  it('signs the attributes as a SET, not as the [0] they travel in', async () => {
    const { cert, key } = makeSigner();
    const messageDigest = await sha256([Uint8Array.from([9, 9, 9])]);
    const der = await buildDetachedSignedData({
      messageDigest,
      certificate: cert,
      chain: [],
      privateKey: key,
      signingTime: new Date(),
    });

    const signerInfo = children(children(children(children(parse(der))[1])[0])[4])[0];
    const [, , , signedAttrs, , signature] = children(signerInfo);

    // The attributes travel implicitly tagged [0]…
    expect(signedAttrs.tagClass).toBe(asn1.Class.CONTEXT_SPECIFIC);
    expect(signedAttrs.type).toBe(0);

    // …and the signature is over the same attributes re-tagged as a SET.
    // Getting this wrong (RFC 5652 §5.4) produces a signature nothing accepts.
    const asSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children(signedAttrs));
    const md = forge.md.sha256.create();
    md.update(asn1.toDer(asSet).getBytes());
    const ok = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), signature.value as string);
    expect(ok).toBe(true);
  });

  it('puts the digest it was given into the messageDigest attribute, unchanged', async () => {
    const { cert, key } = makeSigner();
    const messageDigest = await sha256([Uint8Array.from([4, 5, 6])]);
    const der = await buildDetachedSignedData({
      messageDigest,
      certificate: cert,
      chain: [],
      privateKey: key,
      signingTime: new Date(),
    });
    const signerInfo = children(children(children(children(parse(der))[1])[0])[4])[0];
    const attrs = children(children(signerInfo)[3]);
    const found = attrs.find((a) => asn1.derToOid(children(a)[0].value as string) === OID.messageDigest);
    const carried = children(children(found!)[1])[0].value as string;
    expect(forge.util.bytesToHex(carried)).toBe(forge.util.bytesToHex(toBinaryString(messageDigest)));
  });

  it('adds the time-stamp as an UNSIGNED attribute, after the signature', async () => {
    const { cert, key } = makeSigner();
    const der = await buildDetachedSignedData({
      messageDigest: await sha256([Uint8Array.from([1])]),
      certificate: cert,
      chain: [],
      privateKey: key,
      signingTime: new Date(),
      timestamp: async () => Uint8Array.from([0x05, 0x00]),
      timestampAttribute: (tokenDer) =>
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.16.2.14').getBytes()),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [asn1.fromDer(tokenDer)]),
        ]),
    });
    const signerInfo = children(children(children(children(parse(der))[1])[0])[4])[0];
    const last = children(signerInfo)[6];
    expect(last.tagClass).toBe(asn1.Class.CONTEXT_SPECIFIC);
    expect(last.type).toBe(1);
  });

  it('signs without one when the authority says no, rather than claiming one', async () => {
    const { cert, key } = makeSigner();
    const der = await buildDetachedSignedData({
      messageDigest: await sha256([Uint8Array.from([1])]),
      certificate: cert,
      chain: [],
      privateKey: key,
      signingTime: new Date(),
      timestamp: async () => null,
      timestampAttribute: () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    });
    const signerInfo = children(children(children(children(parse(der))[1])[0])[4])[0];
    expect(children(signerInfo)).toHaveLength(6);
  });
});
