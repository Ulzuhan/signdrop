/**
 * Rebuilds the trust store from the EU list of trusted lists, territory by
 * territory.
 *
 * Provenance, because a trust store is only as good as where it came from:
 * the EU LOTL (ec.europa.eu, over HTTPS) names one trusted list per member
 * state plus Iceland, Liechtenstein and Norway; each national list, signed by
 * its scheme operator, carries one X.509 certificate per qualified trust
 * service. This script keeps CA services for signatures and seals, and
 * time-stamping services, with their status — granted or withdrawn, and since
 * when — so the verifier can say "issued under a service withdrawn on <date>"
 * instead of pretending. Web-authentication CAs are left out: they sign
 * servers, not people.
 *
 * One file per territory, `public/trust/<cc>.json`, plus two indexes:
 * `index.json`, a few kilobytes saying how old every list is and how much it
 * holds, and `thumbprints.json`, the map from each anchor's SHA-256 to the
 * territory that lists it. They are two files and not one because the loader
 * reads the first on every verification and the second only when no issuer
 * names a country it can resolve — and the map is a quarter of a megabyte.
 * All of it is a static asset fetched on demand: the whole of Europe is
 * megabytes of certificates and belongs in nobody's JavaScript bundle.
 *
 * A list that will not download or parse does NOT break the rest: the run
 * reports it, keeps whatever file that territory already had, and the index
 * says how stale it is. What the index never does is pretend: a territory
 * with no file at all is recorded as unavailable, with the reason, so the
 * verifier can say "not judged" instead of "not on the list".
 *
 * Cross-check, for Spain: the list carries the ISSUING authorities of each
 * qualified service, not national roots — so the FNMT's "AC FNMT Usuarios",
 * which is what signs a citizen's certificate, must be in what we extracted,
 * and it must verify against the FNMT root published on cert.fnmt.es. Either
 * fails and es.json is not written.
 *
 *   node scripts/update-trust-store.mjs
 *
 * Importable as a module: `extractAnchors` and `stripNamespaces` are what
 * scripts/test-trust.mjs exercises against a fixture, so the parsing is
 * covered without going near the network.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import forge from 'node-forge';

const LOTL = 'https://ec.europa.eu/tools/lotl/eu-lotl.xml';
const FNMT_ROOT = 'https://www.cert.fnmt.es/certs/ACRAIZFNMTRCM.crt';
const FNMT_USERS_CA = 'https://www.cert.fnmt.es/certs/ACUSU.crt';
const OUT_DIR = fileURLToPath(new URL('../public/trust/', import.meta.url));
const UA = 'signdrop-trust-store/2.0 (+https://github.com/Ulzuhan/signdrop)';
const TIMEOUT_MS = 90_000;
const PARALLEL = 6;

/**
 * `EU` is the LOTL pointing at itself; `UK` is the final list left behind
 * after Brexit, which is no longer a trusted list of the Union. Neither is a
 * territory whose certificates we should call qualified today.
 */
const SKIP_TERRITORIES = new Set(['EU', 'UK']);

const KEEP_TYPES = {
  'http://uri.etsi.org/TrstSvc/Svctype/CA/QC': 'CA/QC',
  'http://uri.etsi.org/TrstSvc/Svctype/TSA/QTST': 'TSA/QTST',
  'http://uri.etsi.org/TrstSvc/Svctype/TSA': 'TSA',
  'http://uri.etsi.org/TrstSvc/Svctype/TSA/TSS-QC': 'TSA/TSS-QC',
};
const USES = {
  ForeSignatures: 'signatures',
  ForeSeals: 'seals',
  ForWebSiteAuthentication: 'web',
};

// ─── Fetching ────────────────────────────────────────────────────────────────

/**
 * Plain HTTP is refused rather than downgraded quietly.
 *
 * We do not verify the XMLDSig on a national list, so the only thing standing
 * between us and a forged trust anchor is the transport. The LOTL comes over
 * HTTPS and pins the certificate that signs each national list, so the honest
 * way to accept a plain-HTTP list would be to verify that signature — real
 * work (C14N, references, transforms) and not done yet. Until then a list we
 * cannot fetch safely is one we do not have, and the index says so.
 */
function requireHttps(url) {
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`the list is published over plain HTTP (${url}); refusing to trust anchors fetched without transport security`);
  }
}

export const stripNamespaces = (xml) => xml.replace(/<(\/?)[A-Za-z0-9_.-]+:/g, '<$1');

async function fetchText(url, { attempts = 2 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return stripNamespaces(await res.text());
    } catch (error) {
      last = error;
    }
  }
  throw new Error(last?.message ?? String(last));
}

// ─── XML, by hand ────────────────────────────────────────────────────────────
// A real parser would cost a dependency for a script that runs once a month,
// but the lists are not uniform: most write bare element names and Hungary
// writes `<ns3:TrustServiceProvider>`. So every prefix is stripped from the
// tag names first and the rest of the script reads one shape. Attributes are
// untouched, which is what keeps `xml:lang="en"` working.


const one = (re, s) => (s.match(re) ?? [])[1] ?? null;
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
const unescapeXml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const pem = (b64) => `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';

/**
 * A distinguished name reduced to one comparable string.
 *
 * Must produce exactly what `dnKey` in src/lib/trust/store.ts produces from a
 * parsed certificate's `issuer.attributes`, because the two are compared
 * against each other. Kept as a copy rather than an import so this script
 * runs under plain `node`, with no loader, which is how the monthly workflow
 * runs it.
 */
function dnKey(attributes) {
  return attributes
    .map((a) => `${a.shortName ?? a.type}=${String(a.value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`)
    .join('/');
}

/**
 * Subject and key type, read straight out of the DER.
 *
 * node-forge refuses to parse a certificate whose public key is not RSA, and
 * 255 of Europe's 3400 qualified authorities use elliptic curves — 43 of
 * Spain's alone. Dropping them silently would make the verifier answer "not
 * on the trusted list" about certificates that are, which is the one kind of
 * lie this product cannot afford. So every anchor records its subject and its
 * key algorithm here, with an ASN.1 walk that does not care about the key,
 * and the judgement uses them to say "listed, but with a key I cannot check".
 */
function identify(der) {
  const cert = forge.asn1.fromDer(der.toString('binary'));
  const tbs = cert.value[0];
  // TBSCertificate: [0] version (optional), serial, signature, issuer,
  // validity, subject, subjectPublicKeyInfo, ...
  const shift = tbs.value[0].tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 0 : -1;
  const subject = dnKey(forge.pki.RDNAttributesAsArray(tbs.value[5 + shift]));
  const algorithm = forge.asn1.derToOid(tbs.value[6 + shift].value[0].value[0].value);
  return { subject, key: algorithm === OID_EC_PUBLIC_KEY ? 'ec' : algorithm === '1.2.840.113549.1.1.1' ? 'rsa' : algorithm };
}

/** Every anchor a national list holds, keyed by the SHA-256 of its DER. */
export function extractAnchors(tsl, tslUrl) {
  const source = {
    tsl: tslUrl,
    sequence: Number(one(/<TSLSequenceNumber>(\d+)<\/TSLSequenceNumber>/, tsl)) || null,
    issued: one(/<ListIssueDateTime>([^<]+)<\/ListIssueDateTime>/, tsl),
    nextUpdate: one(/<NextUpdate>\s*<dateTime>([^<]+)<\/dateTime>/, tsl),
    retrievedAt: new Date().toISOString(),
  };

  const anchors = new Map();
  let providers = 0;
  let certificates = 0;
  for (const tsp of all(/<TrustServiceProvider>([\s\S]*?)<\/TrustServiceProvider>/g, tsl)) {
    providers++;
    const tspInfo = one(/<TSPInformation>([\s\S]*?)<\/TSPInformation>/, tsp) ?? '';
    const provider = unescapeXml(
      one(/<TSPName>[\s\S]*?<Name xml:lang="en">([^<]+)<\/Name>/, tspInfo) ??
        one(/<TSPName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, tspInfo) ??
        '?'
    );
    const tradeName = one(/<TSPTradeName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, tspInfo);
    for (const svc of all(/<TSPService>([\s\S]*?)<\/TSPService>/g, tsp)) {
      const info = one(/<ServiceInformation>([\s\S]*?)<\/ServiceInformation>/, svc) ?? '';
      const typeUri = one(/<ServiceTypeIdentifier>([^<]+)<\/ServiceTypeIdentifier>/, info);
      const type = KEEP_TYPES[typeUri];
      if (!type) continue;
      const uses = Object.entries(USES)
        .filter(([k]) => info.includes(`/SvcInfoExt/${k}`))
        .map(([, v]) => v);
      if (type === 'CA/QC' && uses.length && !uses.includes('signatures') && !uses.includes('seals')) continue;
      const service = unescapeXml(
        one(/<ServiceName>[\s\S]*?<Name xml:lang="en">([^<]+)<\/Name>/, info) ??
          one(/<ServiceName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, info) ??
          '?'
      );
      const status = (one(/<ServiceStatus>([^<]+)<\/ServiceStatus>/, info) ?? '').split('/').pop();
      const statusSince = one(/<StatusStartingTime>([^<]+)<\/StatusStartingTime>/, info);
      for (const raw of all(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/g, info)) {
        const b64 = raw.replace(/\s+/g, '');
        if (!b64) continue;
        let sha256;
        let identity;
        try {
          const der = Buffer.from(b64, 'base64');
          sha256 = sha256Hex(der);
          identity = identify(der);
        } catch {
          // Not a certificate we can even name; it cannot anchor anything.
          continue;
        }
        certificates++;
        const entry = anchors.get(sha256) ?? { sha256, subject: identity.subject, key: identity.key, pem: pem(b64), services: [] };
        entry.services.push({ provider, tradeName: tradeName ? unescapeXml(tradeName) : null, service, type, status, statusSince, uses });
        anchors.set(sha256, entry);
      }
    }
  }
  if (anchors.size === 0) throw new Error('the list parsed but holds no qualified CA or TSA certificate');
  return { source, providers, certificates, anchors: [...anchors.values()] };
}

// ─── The Spanish cross-check ─────────────────────────────────────────────────

async function crossCheckSpain(anchors) {
  const der = async (url) => Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).arrayBuffer());
  const rootDer = await der(FNMT_ROOT);
  const usersDer = await der(FNMT_USERS_CA);
  const usersSha = sha256Hex(usersDer);
  if (!anchors.some((a) => a.sha256 === usersSha)) {
    throw new Error(`AC FNMT Usuarios from ${FNMT_USERS_CA} (${usersSha}) is not in the extracted list`);
  }
  const root = forge.pki.certificateFromAsn1(forge.asn1.fromDer(rootDer.toString('binary')));
  const users = forge.pki.certificateFromAsn1(forge.asn1.fromDer(usersDer.toString('binary')));
  if (!root.verify(users)) throw new Error('AC FNMT Usuarios does not verify against the published FNMT root');
  return {
    fnmtRoot: { url: FNMT_ROOT, sha256: sha256Hex(rootDer) },
    fnmtUsersCa: { url: FNMT_USERS_CA, sha256: usersSha, inList: true, verifiesAgainstRoot: true },
  };
}

// ─── The run ─────────────────────────────────────────────────────────────────

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) results[i] = await worker(items[i], i);
    })
  );
  return results;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function main() {
  console.log('LOTL:', LOTL);
  const lotl = await fetchText(LOTL);
  const pointers = [...lotl.matchAll(/<OtherTSLPointer>([\s\S]*?)<\/OtherTSLPointer>/g)]
    .map((m) => m[1])
    .filter((p) => /application\/vnd\.etsi\.tsl\+xml/.test(p))
    .map((p) => ({
      territory: one(/<SchemeTerritory>([^<]+)<\/SchemeTerritory>/, p),
      url: one(/<TSLLocation>([^<]+)<\/TSLLocation>/, p),
    }))
    .filter((p) => p.territory && p.url && !SKIP_TERRITORIES.has(p.territory))
    .sort((a, b) => a.territory.localeCompare(b.territory));

  if (pointers.length < 25) throw new Error(`the LOTL only yielded ${pointers.length} territories; that is not the Union`);
  console.log(`territories: ${pointers.length} (${pointers.map((p) => p.territory).join(' ')})`);

  mkdirSync(OUT_DIR, { recursive: true });
  const indexPath = `${OUT_DIR}index.json`;
  const thumbprintsPath = `${OUT_DIR}thumbprints.json`;
  const previousIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf-8')) : { territories: {} };

  const outcomes = await pool(pointers, PARALLEL, async ({ territory, url }) => {
    const cc = territory.toLowerCase();
    try {
      requireHttps(url);
      const tsl = await fetchText(url);
      const extracted = extractAnchors(tsl, url);
      const file = { territory, source: extracted.source, anchors: extracted.anchors };
      if (territory === 'ES') file.crossCheck = await crossCheckSpain(extracted.anchors);
      const json = JSON.stringify(file) + '\n';
      writeFileSync(`${OUT_DIR}${cc}.json`, json);
      console.log(
        `  ${territory}  ok    providers ${String(extracted.providers).padStart(3)} · anchors ${String(extracted.anchors.length).padStart(4)} · ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`
      );
      return { territory, cc, ok: true, file, bytes: Buffer.byteLength(json), providers: extracted.providers };
    } catch (error) {
      console.log(`  ${territory}  FAIL  ${error.message}`);
      return { territory, cc, ok: false, error: error.message };
    }
  });

  // The index: which territory holds each anchor, and how old every list is.
  const territories = {};
  const byThumbprint = {};
  for (const outcome of outcomes) {
    const { territory, cc } = outcome;
    if (outcome.ok) {
      const { source, anchors, crossCheck } = outcome.file;
      territories[cc] = {
        territory,
        tsl: source.tsl,
        sequence: source.sequence,
        issued: source.issued,
        nextUpdate: source.nextUpdate,
        retrievedAt: source.retrievedAt,
        providers: outcome.providers,
        anchors: anchors.length,
        bytes: outcome.bytes,
        ...(crossCheck ? { crossChecked: true } : {}),
      };
      for (const anchor of anchors) byThumbprint[anchor.sha256] = cc;
      continue;
    }
    // Kept from the last good run, if there is a file to keep. A territory
    // whose list we have never had is recorded as unavailable, not as empty:
    // the verifier must be able to tell "not judged" from "not on the list".
    const kept = previousIndex.territories?.[cc];
    const path = `${OUT_DIR}${cc}.json`;
    if (kept && existsSync(path)) {
      territories[cc] = { ...kept, stale: true, staleSince: new Date().toISOString(), lastError: outcome.error };
      try {
        for (const anchor of JSON.parse(readFileSync(path, 'utf-8')).anchors) byThumbprint[anchor.sha256] = cc;
      } catch {
        territories[cc] = { territory, unavailable: outcome.error };
      }
    } else {
      territories[cc] = { territory, unavailable: outcome.error };
    }
  }

  const generatedAt = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify({ lotl: LOTL, generatedAt, territories }) + '\n');
  writeFileSync(thumbprintsPath, JSON.stringify({ generatedAt, byThumbprint }) + '\n');

  const ok = outcomes.filter((o) => o.ok).length;
  const anchors = Object.keys(byThumbprint).length;
  const total = Object.values(territories).reduce((n, t) => n + (t.bytes ?? 0), 0);
  console.log(
    `\n${ok}/${outcomes.length} lists · ${anchors} anchors · ${(total / 1024 / 1024).toFixed(1)} MB across the files` +
      ` · index ${(statSync(indexPath).size / 1024).toFixed(1)} KB · thumbprints ${(statSync(thumbprintsPath).size / 1024).toFixed(0)} KB`
  );
  const es = territories.es;
  if (es?.crossChecked) console.log('AC FNMT Usuarios is in the Spanish list and verifies against the published FNMT root');

  const unavailable = Object.entries(territories).filter(([, t]) => t.unavailable);
  const stale = Object.entries(territories).filter(([, t]) => t.stale);
  for (const [cc, t] of stale) console.log(`stale: ${cc} kept from ${t.retrievedAt} — ${t.lastError}`);
  for (const [cc, t] of unavailable) console.log(`unavailable: ${cc} — ${t.unavailable}`);
  // Spain is the one this house checks by hand and the one the suite asserts on:
  // a run that loses it is a failed run, whatever else it managed to fetch.
  if (!es || es.unavailable) {
    console.error('\nSpain is missing from the store; failing the run');
    process.exit(1);
  }
}

// Only when run, not when imported by the suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
