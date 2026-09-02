/**
 * Downloading the trusted lists: only the countries a document needs, once.
 *
 * The store is thirty files and eight megabytes — the whole of Europe's
 * qualified providers. No page should ever load that. What a document needs
 * is normally one country: a Spanish certificate resolves against `es.json`
 * and nothing else is fetched. So the loader works from the certificates the
 * signature carries:
 *
 *   1. the `C=` of every issuer and subject names the territories to try;
 *   2. those files are fetched, in parallel, and kept in memory for the tab;
 *   3. if nothing resolved — a certificate with no country in its DN — the
 *      thumbprint index says which territory lists each anchor, and the one
 *      that matches is fetched.
 *
 * What it never does is answer from silence. A list that will not download,
 * or a territory the store does not have, comes back as `unavailable` with
 * the reason, and the judgement says "not judged" instead of "not on the
 * list". The two are different verdicts and the difference is the honest
 * part of this product: Slovakia publishes its list over plain HTTP and we
 * refuse to fetch it, so a Slovak qualified signature is one we cannot vouch
 * for — not one we have ruled out.
 */
import forge from 'node-forge';
import { territoryOf, type TerritoryInfo, type TerritoryStore, type ThumbprintIndex, type TrustAnchor, type TrustIndex, type TrustStoreView } from './store';

export interface TrustLoaderOptions {
  /** Where the files live. Same origin by default: nothing here talks to a third party. */
  base?: string;
  fetch?: typeof globalThis.fetch;
}

const sha256OfDer = (der: string): string => {
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
};

export class TrustLoader {
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private indexPromise: Promise<TrustIndex> | null = null;
  private thumbprintsPromise: Promise<ThumbprintIndex> | null = null;
  private readonly territories = new Map<string, Promise<TerritoryStore>>();

  /** What was actually consulted, for the page to show its provenance. */
  readonly consulted = new Map<string, TerritoryInfo>();
  /** Territory -> why its list is not among the anchors. */
  readonly unavailable: Record<string, string> = {};
  /** Territories the trusted lists do not cover: outside the Union, nothing is qualified. */
  readonly outside = new Set<string>();

  constructor(options: TrustLoaderOptions = {}) {
    this.base = options.base ?? '/trust/';
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async json<T>(name: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${name}`, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** The small index: how old every list is, and which ones exist at all. */
  index(): Promise<TrustIndex> {
    this.indexPromise ??= this.json<TrustIndex>('index.json');
    return this.indexPromise;
  }

  private thumbprints(): Promise<ThumbprintIndex> {
    this.thumbprintsPromise ??= this.json<ThumbprintIndex>('thumbprints.json');
    return this.thumbprintsPromise;
  }

  /**
   * One territory's anchors, or an entry in `unavailable` saying why not.
   * Fetched at most once per loader, whatever asks for it.
   */
  private async territory(cc: string, index: TrustIndex): Promise<TrustAnchor[]> {
    const key = cc.toLowerCase();
    const info = index.territories[key];
    if (!info) {
      // Not a gap in the store: the EU trusted lists cover the Union plus
      // Iceland, Liechtenstein and Norway, and nowhere else. A certificate
      // from anywhere else is definitively not qualified.
      this.outside.add(cc.toUpperCase());
      return [];
    }
    if (info.unavailable) {
      this.unavailable[cc.toUpperCase()] = info.unavailable;
      return [];
    }
    let promise = this.territories.get(key);
    if (!promise) {
      promise = this.json<TerritoryStore>(`${key}.json`);
      this.territories.set(key, promise);
    }
    try {
      const store = await promise;
      this.consulted.set(cc.toUpperCase(), info);
      return store.anchors;
    } catch (error) {
      // A file that will not load is not an empty list. Forget the rejected
      // promise so a later document can try again.
      this.territories.delete(key);
      this.unavailable[cc.toUpperCase()] = `the list could not be downloaded (${(error as Error).message})`;
      return [];
    }
  }

  /**
   * The anchors to judge these certificates against.
   *
   * Throws only when the index itself is unreachable — offline, say — because
   * then nothing can be said about anything, and the caller must report the
   * signature as mathematically sound with its issuer not judged.
   */
  async view(certificates: forge.pki.Certificate[]): Promise<TrustStoreView> {
    const index = await this.index();

    const wanted = new Set<string>();
    for (const cert of certificates) {
      const issuer = territoryOf(cert, 'issuer');
      const subject = territoryOf(cert, 'subject');
      if (issuer) wanted.add(issuer);
      if (subject) wanted.add(subject);
    }

    let anchors = (await Promise.all([...wanted].map((cc) => this.territory(cc, index)))).flat();

    // Nothing resolved: no country in any DN, or every one of them missing.
    // The thumbprint index knows where each anchor lives; if one of the
    // carried certificates IS an anchor, it names the territory exactly.
    if (anchors.length === 0) {
      try {
        const { byThumbprint } = await this.thumbprints();
        const extra = new Set<string>();
        for (const cert of certificates) {
          const cc = byThumbprint[sha256OfDer(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())];
          if (cc && !wanted.has(cc.toUpperCase())) extra.add(cc.toUpperCase());
        }
        if (extra.size) {
          anchors = (await Promise.all([...extra].map((cc) => this.territory(cc, index)))).flat();
          for (const cc of extra) wanted.add(cc);
        }
      } catch {
        // The fallback is a convenience, not a requirement: without it the
        // verdict is "not judged", which is what it would have been anyway.
      }
    }

    return {
      anchors,
      loaded: [...this.consulted.keys()],
      unavailable: { ...this.unavailable },
      outside: [...this.outside],
    };
  }

  /** Bound for `verifyPdfSignatures({ trust })`. */
  get provider() {
    return (certificates: forge.pki.Certificate[]) => this.view(certificates);
  }
}
