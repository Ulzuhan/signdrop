/**
 * PAdES (PDF Advanced Electronic Signature) engine using node-forge and pdf-lib.
 * 100% Client-side. Generates standard ISO 32000-1 / ETSI EN 319 142 digital signatures.
 */
import forge from 'node-forge';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber, PDFString } from 'pdf-lib';
import { DigitalCertificateInfo } from './pades-types';
import { signatureTimeStampAttribute } from './pades-verifier';

export interface ParsedPkcs12 {
  cert: forge.pki.Certificate;
  key: forge.pki.PrivateKey;
  caCertificates: forge.pki.Certificate[];
  info: DigitalCertificateInfo;
}

/**
 * Parses a .p12 / .pfx PKCS#12 bundle in browser memory.
 */
export function parsePkcs12Bundle(p12Buffer: ArrayBuffer | Uint8Array, password = ''): ParsedPkcs12 {
  const bytes = p12Buffer instanceof Uint8Array ? p12Buffer : new Uint8Array(p12Buffer);
  const binaryStr = forge.util.createBuffer(bytes as unknown as forge.util.ArrayBufferView).getBytes();
  const asn1 = forge.asn1.fromDer(binaryStr);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  // Extract certificate and private key safe bags
  let userCert: forge.pki.Certificate | null = null;
  let privateKey: forge.pki.PrivateKey | null = null;
  const caCerts: forge.pki.Certificate[] = [];

  // Iterate over bags
  for (const bag of p12.safeContents) {
    for (const safeBag of bag.safeBags) {
      if (safeBag.cert) {
        if (!userCert) {
          userCert = safeBag.cert;
        } else {
          caCerts.push(safeBag.cert);
        }
      }
      if (safeBag.key) {
        privateKey = safeBag.key;
      }
    }
  }

  // Fallback search
  if (!userCert) {
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const bags = certBags[forge.pki.oids.certBag];
    if (bags && bags.length > 0 && bags[0].cert) {
      userCert = bags[0].cert;
    }
  }

  if (!privateKey) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const bags = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (bags && bags.length > 0 && bags[0].key) {
      privateKey = bags[0].key;
    } else {
      const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
      const pBags = plainKeyBags[forge.pki.oids.keyBag];
      if (pBags && pBags.length > 0 && pBags[0].key) {
        privateKey = pBags[0].key;
      }
    }
  }

  if (!userCert || !privateKey) {
    throw new Error('No se pudo extraer el certificado o la clave privada del archivo .p12/.pfx.');
  }

  // Extract human-readable details
  const getAttr = (attrs: forge.pki.Certificate['subject']['attributes'], name: string) => {
    const attr = attrs.find((a) => a.name === name || a.shortName === name);
    return attr ? String(attr.value) : '';
  };

  const commonName = getAttr(userCert.subject.attributes, 'commonName') || 'Firmante Digital';
  const organization = getAttr(userCert.subject.attributes, 'organizationName');
  const country = getAttr(userCert.subject.attributes, 'countryName');
  const issuerCn = getAttr(userCert.issuer.attributes, 'commonName') || 'Emisor CA';

  const validFrom = userCert.validity.notBefore.toISOString();
  const validTo = userCert.validity.notAfter.toISOString();
  const isExpired = userCert.validity.notAfter < new Date();
  const serialNumber = userCert.serialNumber;

  const info: DigitalCertificateInfo = {
    commonName,
    organization,
    country,
    issuer: issuerCn,
    validFrom,
    validTo,
    serialNumber,
    isExpired,
  };

  return {
    cert: userCert,
    key: privateKey,
    caCertificates: caCerts,
    info,
  };
}

export interface PadesSignOptions {
  pdfBytes: Uint8Array | ArrayBuffer;
  p12Data: ParsedPkcs12;
  reason?: string;
  location?: string;
  contactInfo?: string;
  /**
   * Asked for an RFC 3161 token over the signature value, once it exists.
   * What it returns is embedded in the signature as the unsigned attribute
   * PAdES-B-T requires (signature-time-stamp). Returning null signs without
   * one; throwing aborts the signature, because a document that claims a
   * time-stamp it does not carry is worse than one that says it has none.
   */
  timestamp?: (signatureValue: Uint8Array) => Promise<Uint8Array | null>;
}

// 24 KiB of hex for the CMS. A signer certificate with its chain is 2-4 KB
// and a TSA token with the TSA's chain another 4-8 KB; the old 8 KiB budget
// had no room for the token.
const SIGNATURE_HEX_LENGTH = 24576 * 2;
const BYTE_RANGE_PLACEHOLDER = '0000000000 0000000000 0000000000 0000000000';

/**
 * Embeds a cryptographic PAdES PKCS#7 detached signature into the PDF structure.
 */
export async function signPdfWithPades(options: PadesSignOptions): Promise<Uint8Array> {
  const { pdfBytes, p12Data, reason = 'Documento sellado y firmado digitalmente con SignDrop', location = 'Client Browser', contactInfo, timestamp } = options;

  const inputBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

  // Format PDF date string: (D:YYYYMMDDHHmmSS+00'00')
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const pdfDate = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  // Create signature dictionary object
  const sigDict = pdfDoc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: PDFArray.withContext(pdfDoc.context),
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_HEX_LENGTH)),
    Reason: PDFString.of(reason),
    M: PDFString.of(pdfDate),
    Name: PDFString.of(p12Data.info.commonName),
    Location: PDFString.of(location),
    ...(contactInfo ? { ContactInfo: PDFString.of(contactInfo) } : {}),
  });

  const sigDictRef = pdfDoc.context.register(sigDict);

  // Add signature field to AcroForm
  let acroForm = pdfDoc.catalog.get(PDFName.of('AcroForm')) as PDFDict;
  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3, // SignaturesExist (1) + AppendOnly (2)
    });
    pdfDoc.catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // Create signature form field
  const sigField = pdfDoc.context.obj({
    FT: 'Sig',
    T: PDFString.of(`Signature_${Date.now()}`),
    V: sigDictRef,
    P: pdfDoc.getPages()[0].ref,
  });
  const sigFieldRef = pdfDoc.context.register(sigField);

  const fields = acroForm.get(PDFName.of('Fields')) as PDFArray;
  if (fields) {
    fields.push(sigFieldRef);
  } else {
    acroForm.set(PDFName.of('Fields'), pdfDoc.context.obj([sigFieldRef]));
  }

  // Reserve exact byte range placeholder in sigDict
  const byteRangeArray = sigDict.get(PDFName.of('ByteRange')) as PDFArray;
  byteRangeArray.push(PDFNumber.of(0));
  byteRangeArray.push(PDFNumber.of(1000000000));
  byteRangeArray.push(PDFNumber.of(1000000000));
  byteRangeArray.push(PDFNumber.of(1000000000));

  const savedPdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const pdfString = forge.util.createBuffer(savedPdfBytes as unknown as forge.util.ArrayBufferView).getBytes();

  // Locate OUR signature dictionary, not the first one in the file: a PDF that
  // already carried a signature has its own /Contents earlier. The placeholder
  // ByteRange written above is unique to this run.
  const placeholderIndex = pdfString.indexOf('1000000000 1000000000 1000000000');
  if (placeholderIndex === -1) {
    throw new Error('No se encontró el placeholder /ByteRange en la estructura del PDF');
  }
  const dictStart = pdfString.lastIndexOf('<<', placeholderIndex);
  const dictEnd = pdfString.indexOf('>>', placeholderIndex);
  let contentsIndex = pdfString.indexOf('/Contents <', dictStart);
  if (contentsIndex === -1 || contentsIndex > dictEnd) {
    contentsIndex = pdfString.lastIndexOf('/Contents <', placeholderIndex);
  }
  if (contentsIndex < dictStart || contentsIndex === -1) {
    throw new Error('No se encontró el placeholder /Contents en la estructura del PDF');
  }

  const hexStartIndex = contentsIndex + '/Contents <'.length;
  const hexEndIndex = hexStartIndex + SIGNATURE_HEX_LENGTH;

  // ByteRange partitions:
  // Part 1: from byte 0 to hexStartIndex - 1 (before '<')
  // Part 2: from hexEndIndex + 1 (after '>') to EOF
  const offset1 = 0;
  const length1 = hexStartIndex - 1;
  const offset2 = hexEndIndex + 1;
  const length2 = savedPdfBytes.length - offset2;

  const actualByteRange = `/ByteRange [${offset1} ${length1} ${offset2} ${length2}]`;
  const byteRangeIndex = pdfString.lastIndexOf('/ByteRange [', placeholderIndex);
  const byteRangeEndIndex = pdfString.indexOf(']', byteRangeIndex) + 1;
  const oldByteRange = pdfString.substring(byteRangeIndex, byteRangeEndIndex);

  // Pad actualByteRange to match oldByteRange length so offsets remain exact
  const paddedByteRange = actualByteRange.padEnd(oldByteRange.length, ' ');

  // Inject padded ByteRange into raw PDF
  const preparedPdf =
    pdfString.substring(0, byteRangeIndex) +
    paddedByteRange +
    pdfString.substring(byteRangeEndIndex);

  const preparedBytes = new Uint8Array(preparedPdf.length);
  for (let i = 0; i < preparedPdf.length; i++) {
    preparedBytes[i] = preparedPdf.charCodeAt(i);
  }

  // Compute SHA-256 over the covered byte ranges
  const range1 = preparedBytes.subarray(offset1, offset1 + length1);
  const range2 = preparedBytes.subarray(offset2, offset2 + length2);

  // The covered bytes ARE the content forge signs, in detached mode: forge
  // computes the messageDigest attribute itself from `content`, and ignores
  // any value handed to it. The previous version handed it the digest and
  // left `content` empty, so every signature carried the digest of nothing —
  // which no verifier, ours included, would ever accept.
  const covered = forge.util.createBuffer();
  covered.putBytes(forge.util.binary.raw.encode(range1));
  covered.putBytes(forge.util.binary.raw.encode(range2));

  // Build CMS / PKCS#7 signedData
  const p7 = forge.pkcs7.createSignedData();
  p7.content = covered;
  p7.addCertificate(p12Data.cert);
  for (const caCert of p12Data.caCertificates) {
    p7.addCertificate(caCert);
  }

  p7.addSigner({
    key: p12Data.key as any,
    certificate: p12Data.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        // Filled in by forge with the digest of `content`.
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        value: now as any,
      },
    ],
  });

  // Generate detached signature
  p7.sign({ detached: true });
  const rawSignatureAsn1 = p7.toAsn1();

  // PAdES-B-T: the time-stamp token goes in as an unsigned attribute of the
  // SignerInfo, imprinting the signature value. It is added to the ASN.1 tree
  // after signing, which is exactly why it is *unsigned*.
  if (timestamp) {
    const signatureBinary = (p7 as unknown as { signers: Array<{ signature: string }> }).signers[0].signature;
    const signatureValue = new Uint8Array(signatureBinary.length);
    for (let i = 0; i < signatureBinary.length; i++) signatureValue[i] = signatureBinary.charCodeAt(i);
    const tokenDer = await timestamp(signatureValue);
    if (tokenDer) {
      const signedData = (rawSignatureAsn1.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[];
      const signerInfos = (signedData[0].value as forge.asn1.Asn1[]).slice(-1)[0];
      const signerInfo = (signerInfos.value as forge.asn1.Asn1[])[0];
      (signerInfo.value as forge.asn1.Asn1[]).push(
        forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 1, true, [
          signatureTimeStampAttribute(forge.util.binary.raw.encode(tokenDer)),
        ])
      );
    }
  }

  const rawSignatureDer = forge.asn1.toDer(rawSignatureAsn1).getBytes();
  const signatureHex = forge.util.bytesToHex(rawSignatureDer);

  if (signatureHex.length > SIGNATURE_HEX_LENGTH) {
    throw new Error(`La firma digital excede el buffer reservado (${signatureHex.length} > ${SIGNATURE_HEX_LENGTH})`);
  }

  const paddedSignatureHex = signatureHex.padEnd(SIGNATURE_HEX_LENGTH, '0');

  // Insert signature hex into /Contents
  const finalPdf =
    preparedPdf.substring(0, hexStartIndex) +
    paddedSignatureHex +
    preparedPdf.substring(hexEndIndex);

  const finalBytes = new Uint8Array(finalPdf.length);
  for (let i = 0; i < finalPdf.length; i++) {
    finalBytes[i] = finalPdf.charCodeAt(i);
  }

  return finalBytes;
}
