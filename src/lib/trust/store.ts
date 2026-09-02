/**
 * The trust store: what the EU trusted lists say, and how a certificate is
 * judged against them.
 *
 * `scripts/update-trust-store.mjs` writes one file per territory under
 * `public/trust/`; this module is the schema those files answer to and the
 * judgement made with them. It is deliberately separate from the verifier:
 * whether a signature's maths hold is a fact about bytes, and whether its
 * issuer is a qualified provider in some member state is a fact about a list
 * published by that state. The first never depends on the network; the
 * second always does. Keeping them apart is what lets /verify say
 * "mathematically sound, issuer not judged" and mean it.
 *
 * Isomorphic: node-forge only, so the suite exercises this exact code in Node.
 */
import forge from 'node-forge';

const asn1 = forge.asn1;

/** One certificate of the trust store, as scripts/update-trust-store.mjs writes it. */
export interface TrustAnchor {
  sha256: string;
  /** The subject DN, reduced by `dnKey`, so an anchor can be found without parsing it. */
  subject: string;
  /** 'rsa', 'ec', or the algorithm's OID. Only RSA anchors can verify a chain here. */
  key: string;
  pem: string;
  services: TrustService[];
}

export interface TrustService {
  provider: string;
  tradeName: string | null;
  service: string;
  type: 'CA/QC' | 'TSA/QTST' | 'TSA' | 'TSA/TSS-QC';
  status: string;
  statusSince: string | null;
  uses: string[];
}

export interface TrustReport {
  /** The certificate chains to a service on the trusted list, within validity. */
  trusted: boolean;
  /**
   * Whether a list was actually consulted. False means the question was not
   * answered — no list for the issuer's territory, or none could be
   * downloaded — and `trusted: false` then carries no information at all.
   * Not being judged and not being trusted are different verdicts and the
   * page must never blur them.
   */
  judged: boolean;
  /** The service the chain ends in, when found — trusted or withdrawn. */
  service: TrustService | null;
  /** The territory whose list settled it, or the one we needed and lacked. */
  territory: string | null;
  reason: string | null;
}

// ─── The indexes ─────────────────────────────────────────────────────────────

/** What one territory's list holds, and how old it is. From `index.json`. */
export interface TerritoryInfo {
  territory: string;
  tsl?: string;
  sequence?: number | null;
  issued?: string | null;
  nextUpdate?: string | null;
  retrievedAt?: string;
  providers?: number;
  anchors?: number;
  bytes?: number;
  /** Spain's list is cross-checked against what the FNMT publishes itself. */
  crossChecked?: boolean;
  /** The last run could not refresh this list; the file is the previous one. */
  stale?: boolean;
  staleSince?: string;
  lastError?: string;
  /**
   * There is no file for this territory at all, and this is why. A certificate
   * issued there must be reported as NOT JUDGED, never as not on the list.
   */
  unavailable?: string;
}

export interface TrustIndex {
  lotl: string;
  generatedAt: string;
  territories: Record<string, TerritoryInfo>;
}

/** `thumbprints.json`: which territory lists each anchor. Only for the fallback. */
export interface ThumbprintIndex {
  generatedAt: string;
  byThumbprint: Record<string, string>;
}

/** One territory's file, `public/trust/<cc>.json`. */
export interface TerritoryStore {
  territory: string;
  source: { tsl: string; sequence: number | null; issued: string | null; nextUpdate: string | null; retrievedAt: string };
  crossCheck?: unknown;
  anchors: TrustAnchor[];
}

// ─── Trust: chaining to the trusted list ─────────────────────────────────────

/**
 * A distinguished name reduced to one comparable string.
 *
 * The same reduction `dnKey` in scripts/update-trust-store.mjs applies when it
 * writes an anchor's `subject`; the two strings are compared to each other, so
 * they have to be built the same way. Attributes keep the order the DN
 * declares them in — reordering a DN changes it.
 */
export function dnKey(attributes: forge.pki.CertificateField[]): string {
  return attributes
    .map((a) => `${a.shortName ?? a.type}=${String(a.value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`)
    .join('/');
}

/**
 * How an anchor is recognised once the chain has been walked.
 *
 * Not by the SHA-256 of its DER, which is the obvious way and the wrong one:
 * that would mean re-encoding the parsed certificate, and forge does not
 * reproduce every issuer's DER byte for byte — D-Trust's CAs came back
 * unrecognised, and the verdict turned into "the chain ends in a listed
 * certificate, but not for this kind of service", which is nonsense a reader
 * cannot act on. Subject plus serial number is what an X.509 chain itself
 * uses to name an issuer, and it survives a parse.
 */
const identityOf = (cert: forge.pki.Certificate) => `${dnKey(cert.subject.attributes)}|${cert.serialNumber}`;

interface AnchorIndex {
  store: forge.pki.CAStore;
  byIdentity: Map<string, TrustAnchor>;
  /** Anchors forge will not parse, by subject DN. Listed, but uncheckable here. */
  unreadableBySubject: Map<string, TrustAnchor>;
}

const anchorCache = new WeakMap<TrustAnchor[], AnchorIndex>();

function anchorStore(anchors: TrustAnchor[]): AnchorIndex {
  let cached = anchorCache.get(anchors);
  if (!cached) {
    const byIdentity = new Map<string, TrustAnchor>();
    const unreadableBySubject = new Map<string, TrustAnchor>();
    const certs: forge.pki.Certificate[] = [];
    for (const anchor of anchors) {
      try {
        const cert = forge.pki.certificateFromPem(anchor.pem);
        certs.push(cert);
        byIdentity.set(identityOf(cert), anchor);
      } catch {
        // node-forge parses RSA certificates and no others, and a twelfth of
        // Europe's qualified authorities sign with elliptic curves. Such an
        // anchor cannot verify a chain — but it is on the list, and keeping
        // its subject is what lets the verdict be "listed, and I cannot check
        // it" rather than the false "not listed".
        if (anchor.subject) unreadableBySubject.set(anchor.subject, anchor);
      }
    }
    cached = { store: forge.pki.createCaStore(certs), byIdentity, unreadableBySubject };
    anchorCache.set(anchors, cached);
  }
  return cached;
}

/** The country code in a certificate's subject or issuer, uppercased. */
export function territoryOf(cert: forge.pki.Certificate, field: 'subject' | 'issuer' = 'issuer'): string | null {
  const value = cert[field].getField('C')?.value;
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

/**
 * The anchors to judge against, and what could not be judged.
 *
 * `unavailable` maps a territory to the reason its list is missing — Slovakia
 * publishes over plain HTTP, say. Without it a Slovak qualified certificate
 * would be reported as "not on the trusted list", which is false: it is on
 * one, we just do not have it.
 */
export interface TrustStoreView {
  anchors: TrustAnchor[];
  /** Territories whose list is loaded in `anchors`. Only these can be ruled out. */
  loaded?: string[];
  /** Territory -> why its list is missing. */
  unavailable?: Record<string, string>;
  /**
   * Territories the EU trusted lists do not cover at all.
   *
   * A different verdict from `unavailable`, and the difference is the whole
   * point. Slovakia has a list we could not fetch, so a Slovak certificate is
   * NOT JUDGED. The United States has no list because qualification under
   * eIDAS does not exist there, so a DigiCert time-stamp is definitively not
   * qualified — which is a fact worth stating, not a gap to apologise for.
   */
  outside?: string[];
}

const notJudged = (territory: string | null, reason: string): TrustReport => ({
  trusted: false,
  judged: false,
  service: null,
  territory,
  reason,
});

/**
 * Does `leaf` chain to a service on the trusted list? The chain is built from
 * the certificates the signature carries; forge checks each signature,
 * validity at `at`, and basic constraints, and stops at the first
 * certificate the store knows. A withdrawn service is reported as such, not
 * as trusted: the list says when it stopped being one.
 */
export function judgeTrust(
  leaf: forge.pki.Certificate,
  carried: forge.pki.Certificate[],
  view: TrustStoreView | TrustAnchor[],
  at: Date | null,
  wanted: (service: TrustService) => boolean
): TrustReport {
  const view2 = Array.isArray(view) ? { anchors: view } : view;
  const { anchors, unavailable } = view2;
  const country = territoryOf(leaf) ?? territoryOf(leaf, 'subject');
  /**
   * Whether a negative answer would mean anything.
   *
   * Saying "not on the trusted list" is only true if we hold the list this
   * certificate would be on. When `loaded` is absent the caller handed us a
   * plain array and vouches for it — that is the suite, and the old contract.
   */
  const canRuleOut = !view2.loaded || (country !== null && view2.loaded.includes(country));
  const outsideTheUnion = country !== null && (view2.outside?.includes(country) ?? false);
  const { store, byIdentity, unreadableBySubject } = anchorStore(anchors);
  // Leaf first, then whoever issued the last link, as far as the signature carries.
  const chain: forge.pki.Certificate[] = [leaf];
  for (let guard = 0; guard < 8; guard++) {
    const top = chain[chain.length - 1];
    if (store.hasCertificate(top) || store.getIssuer(top)) break;
    const issuer = carried.find((c) => c !== top && !chain.includes(c) && top.isIssuer(c));
    if (!issuer) break;
    chain.push(issuer);
  }
  try {
    forge.pki.verifyCertificateChain(store, chain, { validityCheckDate: at ?? new Date() });
  } catch (error) {
    const e = error as { error?: string; message?: string };
    if (e.error === 'forge.pki.UnknownCertificateAuthority') {
      // Before ruling anything out: is the issuer one of the listed
      // authorities this verifier cannot read? Then it IS on the list and the
      // honest answer is that we cannot follow the chain, not that there is
      // none.
      const top = chain[chain.length - 1];
      const uncheckable = unreadableBySubject.get(dnKey(top.issuer.attributes));
      if (uncheckable) {
        const svc = uncheckable.services.find(wanted) ?? uncheckable.services[0] ?? null;
        return {
          trusted: false,
          judged: false,
          service: svc,
          territory: country,
          reason: `The issuer is on the trusted list${svc ? ` (${svc.provider})` : ''}, but signs with an ${uncheckable.key === 'ec' ? 'elliptic-curve' : uncheckable.key} key, which this verifier cannot check.`,
        };
      }
      // A country the trusted lists do not cover is a settled answer, not a
      // gap: outside the Union there is no such thing as a qualified service.
      if (outsideTheUnion) {
        return {
          trusted: false,
          judged: true,
          service: null,
          territory: country,
          reason: `The issuer is in ${country}, which the EU trusted lists do not cover, so this is not a qualified service.`,
        };
      }
      // The chain reaches nothing we hold. Whether that means "not qualified"
      // or "we never looked" depends on having the right country's list.
      if (canRuleOut) return { trusted: false, judged: true, service: null, territory: country, reason: 'The issuer is not on the trusted list.' };
      const why = (country && unavailable?.[country]) ?? null;
      return notJudged(
        country,
        why
          ? `The trusted list for ${country} could not be used: ${why}`
          : country
            ? `No trusted list for ${country} was consulted.`
            : 'The certificate names no country, so there was no list to consult.'
      );
    }
    const reason =
      e.error === 'forge.pki.CertificateExpired' || e.error === 'forge.pki.CertificateNotYetValid'
        ? 'A certificate in the chain was not valid at the signing time.'
        : e.message || 'The certificate chain does not verify.';
    return { trusted: false, judged: true, service: null, territory: country, reason };
  }
  // The anchor: the first certificate of the chain the store holds, or the store's issuer of the top.
  let anchorCert: forge.pki.Certificate | null = null;
  for (const cert of chain) {
    if (store.hasCertificate(cert)) { anchorCert = cert; break; }
    const issuer = store.getIssuer(cert);
    if (issuer) { anchorCert = issuer; break; }
  }
  const anchor = anchorCert ? byIdentity.get(identityOf(anchorCert)) ?? null : null;
  const anchorTerritory = anchorCert ? territoryOf(anchorCert, 'subject') : null;
  const services = anchor ? anchor.services.filter(wanted) : [];
  if (!anchor || services.length === 0) {
    return { trusted: false, judged: true, service: null, territory: country, reason: 'The chain ends in a listed certificate, but not for this kind of service.' };
  }
  const granted = services.find((svc) => svc.status === 'granted');
  const service = granted ?? services[0];
  if (!granted) {
    return { trusted: false, judged: true, service, territory: anchorTerritory ?? country, reason: `The service is listed as ${service.status}${service.statusSince ? ` since ${service.statusSince.slice(0, 10)}` : ''}.` };
  }
  return { trusted: true, judged: true, service, territory: anchorTerritory ?? country, reason: null };
}

export const forSignatures = (svc: TrustService) => svc.type === 'CA/QC';
export const forTimestamps = (svc: TrustService) => svc.type.startsWith('TSA');
