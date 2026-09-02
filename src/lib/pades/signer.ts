/**
 * PAdES (PDF Advanced Electronic Signature) engine using node-forge and pdf-lib.
 * 100% Client-side. Generates standard ISO 32000-1 / ETSI EN 319 142 digital signatures.
 */
import forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFHexString,
  PDFNumber,
  PDFString,
  PDFRef,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  beginText,
  endText,
  setFontAndSize,
  setFillingRgbColor,
  showText,
  moveText,
} from 'pdf-lib';
import { DigitalCertificateInfo } from './types';
import { signatureTimeStampAttribute } from './verifier';
import { appendIncrementalUpdate, hasSignature } from '../pdf/incremental';
import { buildDetachedSignedData, sha256, toBinaryString } from './cms';
import { indexOfAscii, lastIndexOfAscii, writeAscii } from '../pdf/bytes';

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
  /**
   * Where the signature is seen, and what it looks like there. Without one
   * the field is still given a widget, sized zero: an invisible signature is
   * a legitimate thing, a signature field with no widget at all is a
   * malformed one, and pdfsig says so.
   */
  appearance?: SignatureAppearance;
}

/**
 * The visible face of the signature.
 *
 * This is the difference between a picture of a signature and a signature.
 * Until now SignDrop drew the stamp onto the page and then signed the page:
 * what a reader saw and what Acrobat verified were two unrelated things,
 * and pdfsig complained that the signature field had no widget and no
 * bounding box. Now the drawn or typed signature IS the appearance stream of
 * the signature widget, so clicking it in any reader opens the signature it
 * depicts.
 */
export interface SignatureAppearance {
  /** 0-indexed page. */
  pageIndex: number;
  /** [x, y, width, height] in PDF points, origin bottom-left. */
  rect: [number, number, number, number];
  /** PNG or JPEG bytes of the drawn, typed or uploaded signature. */
  image?: Uint8Array;
  /** Drawn when there is no image: one line per entry, top to bottom. */
  lines?: string[];
}

// 24 KiB of hex for the CMS. A signer certificate with its chain is 2-4 KB
// and a TSA token with the TSA's chain another 4-8 KB; the old 8 KiB budget
// had no room for the token.
const SIGNATURE_HEX_LENGTH = 24576 * 2;

/**
 * The signature field and its widget, as one object on one page.
 *
 * ISO 32000-1 allows a field and its single widget to be merged into one
 * dictionary, and that is what every reader expects of a signature. The
 * widget needs /Subtype, /Rect, /F (print) and /P, it has to be listed in
 * the page's /Annots, and if it is meant to be seen it needs an /AP whose
 * /N is a form XObject drawing it. Miss any of that and pdfsig says
 * "was asked for widget and didn't had one" and invents one, which is
 * exactly what SignDrop was making it do.
 *
 * With no appearance the widget is still created, with a zero rectangle:
 * that is how an invisible signature is spelt, and it is not the same thing
 * as a field with no widget.
 */
async function addSignatureWidget(
  pdfDoc: PDFDocument,
  sigDictRef: PDFRef,
  appearance: SignatureAppearance | undefined,
  p12Data: ParsedPkcs12,
  signedAt: Date,
  touched: PDFRef[]
): Promise<PDFRef> {
  const pages = pdfDoc.getPages();
  const pageIndex = appearance ? Math.min(Math.max(appearance.pageIndex, 0), pages.length - 1) : 0;
  const page = pages[pageIndex];
  const [x, y, width, height] = appearance?.rect ?? [0, 0, 0, 0];

  const field = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(`Signature_${signedAt.getTime()}`),
    V: sigDictRef,
    P: page.ref,
    // Print. Never Hidden and never NoView: a signature nobody can print is
    // a signature nobody can rely on.
    F: PDFNumber.of(4),
    Rect: pdfDoc.context.obj([x, y, x + width, y + height]),
  });

  if (appearance && width > 0 && height > 0) {
    const normal = await appearanceStream(pdfDoc, appearance, p12Data, signedAt, width, height);
    field.set(PDFName.of('AP'), pdfDoc.context.obj({ N: normal }));
  }

  const fieldRef = pdfDoc.context.register(field);

  // The page has to know about it, or the widget is an object nobody reaches.
  // /Annots is often an indirect array: appending to the array changes the
  // array, not the page, and an incremental update has to write whichever one
  // actually changed. Reading it with `get` and finding a PDFRef would have
  // meant replacing the page's existing annotations with just this one.
  const annotsEntry = page.node.get(PDFName.of('Annots'));
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots) {
    annots.push(fieldRef);
    touched.push(annotsEntry instanceof PDFRef ? annotsEntry : page.ref);
  } else {
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([fieldRef]));
    touched.push(page.ref);
  }

  return fieldRef;
}

/** The /N appearance: the drawn signature if there is one, else a text block. */
async function appearanceStream(
  pdfDoc: PDFDocument,
  appearance: SignatureAppearance,
  p12Data: ParsedPkcs12,
  signedAt: Date,
  width: number,
  height: number
): Promise<PDFRef> {
  if (appearance.image) {
    const bytes = appearance.image;
    // PNG starts with the eight-byte signature; anything else here is JPEG.
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    const stream = pdfDoc.context.formXObject(
      [pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, 0, 0), drawObject('SigImg'), popGraphicsState()],
      {
        BBox: pdfDoc.context.obj([0, 0, width, height]),
        Resources: pdfDoc.context.obj({ XObject: { SigImg: image.ref } }),
      }
    );
    return pdfDoc.context.register(stream);
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const lines = appearance.lines?.length
    ? appearance.lines
    : [`Digitally signed by ${p12Data.info.commonName}`, signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'];
  // Big enough to read, small enough that two lines fit the box the person drew.
  const size = Math.max(5, Math.min(11, (height - 4) / lines.length - 1));
  const operators = [beginText(), setFillingRgbColor(0.06, 0.21, 0.4), setFontAndSize('SigFont', size)];
  // Td is relative to the start of the previous line, not to the box: the
  // first move places the first line, every later one only drops a line.
  operators.push(moveText(2, height - size - 2), showText(font.encodeText(lines[0])));
  for (const line of lines.slice(1)) {
    operators.push(moveText(0, -(size + 1.5)), showText(font.encodeText(line)));
  }
  operators.push(endText());
  const stream = pdfDoc.context.formXObject(operators, {
    BBox: pdfDoc.context.obj([0, 0, width, height]),
    Resources: pdfDoc.context.obj({ Font: { SigFont: font.ref } }),
  });
  return pdfDoc.context.register(stream);
}

/**
 * The bytes to sign: a rewrite for a first signature, an append for a second.
 *
 * A PDF with no signature in it can be written again from scratch — nothing
 * depends on its byte offsets, and pdf-lib's writer is better tested than
 * anything here. A PDF that is already signed cannot: rewriting it moves
 * every byte and breaks the /ByteRange the first signature promised. So that
 * one gets an incremental update carrying only what changed.
 *
 * `flush()` before either: pdf-lib reserves object numbers for embedded
 * images and fonts when you ask for them and only materialises the objects
 * when the document is saved. Without the flush the appearance stream would
 * point at object numbers nothing ever wrote.
 */
async function writeOut(
  pdfDoc: PDFDocument,
  original: Uint8Array,
  alreadyThere: Set<string>,
  touched: PDFRef[]
): Promise<Uint8Array> {
  await pdfDoc.flush();
  if (!hasSignature(original)) return pdfDoc.save({ useObjectStreams: false });

  const changed = new Map<string, PDFRef>();
  for (const ref of touched) if (ref) changed.set(ref.tag, ref);
  for (const [ref] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!alreadyThere.has(ref.tag)) changed.set(ref.tag, ref);
  }
  return appendIncrementalUpdate({ original, context: pdfDoc.context, changed: [...changed.values()] });
}

/**
 * Embeds a cryptographic PAdES PKCS#7 detached signature into the PDF structure.
 */
export async function signPdfWithPades(options: PadesSignOptions): Promise<Uint8Array> {
  const { pdfBytes, p12Data, reason = 'Documento sellado y firmado digitalmente con SignDrop', location = 'Client Browser', contactInfo, timestamp } = options;

  const inputBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

  // Everything the file already had. Anything not in here by the end is an
  // object this signature created, and an incremental update has to carry it.
  const alreadyThere = new Set(pdfDoc.context.enumerateIndirectObjects().map(([ref]) => ref.tag));
  /** Objects that existed and were changed. New ones are found by difference. */
  const touched: PDFRef[] = [];

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

  // Add signature field to AcroForm. It is an indirect object in most PDFs
  // that were not written by us, so it has to be looked up, not just read:
  // `get` would hand back a PDFRef, which has no `set`.
  const acroFormEntry = pdfDoc.catalog.get(PDFName.of('AcroForm'));
  // The catalog is rewritten either way: either we add the AcroForm to it, or
  // the AcroForm is a direct dictionary inside it and changing one changes the
  // other. It costs a few dozen bytes to be sure.
  const catalogRef = pdfDoc.context.getObjectRef(pdfDoc.catalog);
  if (catalogRef) touched.push(catalogRef);
  if (acroFormEntry instanceof PDFRef) touched.push(acroFormEntry);
  let acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3, // SignaturesExist (1) + AppendOnly (2)
    });
    pdfDoc.catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // Create the signature field, which is also its widget annotation
  const sigFieldRef = await addSignatureWidget(pdfDoc, sigDictRef, options.appearance, p12Data, now, touched);

  const fieldsEntry = acroForm.get(PDFName.of('Fields'));
  if (fieldsEntry instanceof PDFRef) touched.push(fieldsEntry);
  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
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

  const pdf = await writeOut(pdfDoc, inputBytes, alreadyThere, touched);

  // From here on everything happens in this one buffer. The old code turned
  // the whole file into a JavaScript string, searched it, concatenated two
  // more copies of it and converted it back byte by byte — four passes over
  // fifty megabytes to overwrite two short runs of ASCII. Both overwrites are
  // length-preserving by construction, so the offsets written into the
  // cross-reference section stay true.

  // Locate OUR signature dictionary, not the first one in the file: a PDF that
  // already carried a signature has its own /Contents earlier. The placeholder
  // ByteRange written above is unique to this run.
  const placeholderIndex = indexOfAscii(pdf, '1000000000 1000000000 1000000000');
  if (placeholderIndex === -1) throw new Error('The /ByteRange placeholder is not in the saved PDF');

  const dictStart = lastIndexOfAscii(pdf, '<<', placeholderIndex);
  const dictEnd = indexOfAscii(pdf, '>>', placeholderIndex);
  let contentsIndex = indexOfAscii(pdf, '/Contents <', dictStart);
  if (contentsIndex === -1 || (dictEnd !== -1 && contentsIndex > dictEnd)) {
    contentsIndex = lastIndexOfAscii(pdf, '/Contents <', placeholderIndex);
  }
  if (contentsIndex === -1 || contentsIndex < dictStart) throw new Error('The /Contents placeholder is not in the saved PDF');

  const hexStartIndex = contentsIndex + '/Contents <'.length;
  const hexEndIndex = hexStartIndex + SIGNATURE_HEX_LENGTH;

  // Two ranges: everything before the '<' that opens /Contents, and
  // everything after the '>' that closes it. What is left out is exactly the
  // signature, which cannot sign itself.
  const offset1 = 0;
  const length1 = hexStartIndex - 1;
  const offset2 = hexEndIndex + 1;
  const length2 = pdf.length - offset2;

  const byteRangeIndex = lastIndexOfAscii(pdf, '/ByteRange [', placeholderIndex);
  const byteRangeEnd = indexOfAscii(pdf, ']', byteRangeIndex) + 1;
  const actualByteRange = `/ByteRange [${offset1} ${length1} ${offset2} ${length2}]`;
  if (actualByteRange.length > byteRangeEnd - byteRangeIndex) {
    throw new Error('The real /ByteRange is longer than the placeholder reserved for it');
  }
  writeAscii(pdf, byteRangeIndex, actualByteRange.padEnd(byteRangeEnd - byteRangeIndex, ' '));

  // The digest of what the signature covers, computed once, by the platform.
  const messageDigest = await sha256([pdf.subarray(offset1, offset1 + length1), pdf.subarray(offset2, offset2 + length2)]);

  const signatureDer = await buildDetachedSignedData({
    messageDigest,
    certificate: p12Data.cert,
    chain: p12Data.caCertificates,
    privateKey: p12Data.key,
    signingTime: now,
    timestamp,
    timestampAttribute: signatureTimeStampAttribute,
  });

  const signatureHex = forge.util.bytesToHex(toBinaryString(signatureDer));
  if (signatureHex.length > SIGNATURE_HEX_LENGTH) {
    throw new Error(`The signature does not fit the reserved buffer (${signatureHex.length} > ${SIGNATURE_HEX_LENGTH})`);
  }
  writeAscii(pdf, hexStartIndex, signatureHex.padEnd(SIGNATURE_HEX_LENGTH, '0'));

  return pdf;
}
