/**
 * Rebuilds the trust store from the EU list of trusted lists.
 *
 * Provenance, because a trust store is only as good as where it came from:
 * the EU LOTL (ec.europa.eu, over HTTPS) names the Spanish trusted list; the
 * Spanish list (tsl.digital.gob.es, over HTTPS, signed by the scheme
 * operator) carries one X.509 certificate per qualified trust service. This
 * script keeps CA services for signatures and seals, and time-stamping
 * services, with their status — granted or withdrawn, and since when — so
 * the verifier can say "issued under a service withdrawn on <date>" instead
 * of pretending. Web-authentication CAs are left out: they sign servers, not
 * people.
 *
 * Cross-check: the list carries the ISSUING authorities of each qualified
 * service, not national roots — so the FNMT's "AC FNMT Usuarios", which is
 * what signs a citizen's certificate, must be in what we extracted, and it
 * must verify against the FNMT root published on cert.fnmt.es. Either fails
 * and the script refuses to write.
 *
 *   node scripts/update-trust-store.mjs
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import forge from 'node-forge';

const LOTL = 'https://ec.europa.eu/tools/lotl/eu-lotl.xml';
const FNMT_ROOT = 'https://www.cert.fnmt.es/certs/ACRAIZFNMTRCM.crt';
const FNMT_USERS_CA = 'https://www.cert.fnmt.es/certs/ACUSU.crt';
// Served as a static asset and fetched by /verify on demand: ~900 KB of
// certificates do not belong in every page's JavaScript.
const OUT = new URL('../public/trust/es-trusted-list.json', import.meta.url);

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

const text = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'signdrop-trust-store/1.0' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};
const one = (re, s) => (s.match(re) ?? [])[1] ?? null;
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const pem = (b64) => `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;

console.log('LOTL:', LOTL);
const lotl = await text(LOTL);
const esPointer = [...lotl.matchAll(/<OtherTSLPointer>([\s\S]*?)<\/OtherTSLPointer>/g)]
  .map((m) => m[1])
  .find((p) => /<SchemeTerritory>ES<\/SchemeTerritory>/.test(p) && /application\/vnd\.etsi\.tsl\+xml/.test(p));
if (!esPointer) throw new Error('the LOTL has no XML pointer for ES');
const tslUrl = one(/<TSLLocation>([^<]+)<\/TSLLocation>/, esPointer);
console.log('ES TSL:', tslUrl);
const tsl = await text(tslUrl);

const source = {
  lotl: LOTL,
  tsl: tslUrl,
  tslSequenceNumber: Number(one(/<TSLSequenceNumber>(\d+)<\/TSLSequenceNumber>/, tsl)),
  tslIssued: one(/<ListIssueDateTime>([^<]+)<\/ListIssueDateTime>/, tsl),
  tslNextUpdate: one(/<NextUpdate>\s*<dateTime>([^<]+)<\/dateTime>/, tsl),
  retrievedAt: new Date().toISOString(),
};

const anchors = new Map();
let providers = 0;
let kept = 0;
for (const tsp of all(/<TrustServiceProvider>([\s\S]*?)<\/TrustServiceProvider>/g, tsl)) {
  providers++;
  const tspInfo = one(/<TSPInformation>([\s\S]*?)<\/TSPInformation>/, tsp) ?? '';
  const provider = unescapeXml(one(/<TSPName>[\s\S]*?<Name xml:lang="en">([^<]+)<\/Name>/, tspInfo) ?? one(/<TSPName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, tspInfo) ?? '?');
  const tradeName = one(/<TSPTradeName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, tspInfo);
  for (const svc of all(/<TSPService>([\s\S]*?)<\/TSPService>/g, tsp)) {
    const info = one(/<ServiceInformation>([\s\S]*?)<\/ServiceInformation>/, svc) ?? '';
    const typeUri = one(/<ServiceTypeIdentifier>([^<]+)<\/ServiceTypeIdentifier>/, info);
    const type = KEEP_TYPES[typeUri];
    if (!type) continue;
    const uses = Object.entries(USES).filter(([k]) => info.includes(`/SvcInfoExt/${k}`)).map(([, v]) => v);
    if (type === 'CA/QC' && uses.length && !uses.includes('signatures') && !uses.includes('seals')) continue;
    const service = unescapeXml(one(/<ServiceName>[\s\S]*?<Name xml:lang="en">([^<]+)<\/Name>/, info) ?? one(/<ServiceName>[\s\S]*?<Name[^>]*>([^<]+)<\/Name>/, info) ?? '?');
    const status = (one(/<ServiceStatus>([^<]+)<\/ServiceStatus>/, info) ?? '').split('/').pop();
    const statusSince = one(/<StatusStartingTime>([^<]+)<\/StatusStartingTime>/, info);
    for (const raw of all(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/g, info)) {
      const b64 = raw.replace(/\s+/g, '');
      const der = Buffer.from(b64, 'base64');
      const sha256 = createHash('sha256').update(der).digest('hex');
      kept++;
      const entry = anchors.get(sha256) ?? { sha256, pem: pem(b64), services: [] };
      entry.services.push({ provider, tradeName: tradeName ? unescapeXml(tradeName) : null, service, type, status, statusSince, uses });
      anchors.set(sha256, entry);
    }
  }
}

// The cross-check: what the FNMT publishes itself has to be in the list, and
// has to chain to the FNMT root it also publishes.
const der = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());
const rootDer = await der(FNMT_ROOT);
const usersDer = await der(FNMT_USERS_CA);
const usersSha = createHash('sha256').update(usersDer).digest('hex');
if (!anchors.has(usersSha)) throw new Error(`AC FNMT Usuarios from ${FNMT_USERS_CA} (${usersSha}) is not in the extracted list; refusing to write`);
const root = forge.pki.certificateFromAsn1(forge.asn1.fromDer(rootDer.toString('binary')));
const users = forge.pki.certificateFromAsn1(forge.asn1.fromDer(usersDer.toString('binary')));
if (!root.verify(users)) throw new Error('AC FNMT Usuarios does not verify against the published FNMT root; refusing to write');
const rootSha = createHash('sha256').update(rootDer).digest('hex');

const out = {
  source,
  crossCheck: { fnmtRoot: { url: FNMT_ROOT, sha256: rootSha }, fnmtUsersCa: { url: FNMT_USERS_CA, sha256: usersSha, inList: true, verifiesAgainstRoot: true } },
  anchors: [...anchors.values()],
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
const granted = out.anchors.filter((a) => a.services.some((s) => s.status === 'granted')).length;
console.log(`providers ${providers} · service certificates ${kept} · unique anchors ${out.anchors.length} (${granted} under a granted service) · ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KB`);
console.log(`AC FNMT Usuarios in list (${usersSha.slice(0, 16)}…) and verifies against the FNMT root (${rootSha.slice(0, 16)}…)`);
console.log('written', OUT.pathname);
