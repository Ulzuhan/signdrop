/**
 * The trust store: what is extracted from a national list, and which lists
 * get downloaded to judge a document.
 *
 * Nothing here touches the network. The extraction runs against a fixture
 * built to look like the real thing — bare tags in one variant, namespace
 * prefixes in the other, because Hungary writes `<ns3:TrustServiceProvider>`
 * and everyone else does not — and the loader runs against a `fetch` that
 * serves two invented territories and counts what was asked for.
 *
 * The behaviour under test is the one the product is sold on: a certificate
 * whose territory we do not hold must come back NOT JUDGED, never "not on
 * the trusted list".
 */
import forge from 'node-forge';
import assert from 'node:assert/strict';
import { extractAnchors, stripNamespaces } from './update-trust-store.mjs';
import { judgeTrust, forSignatures, forTimestamps } from '../src/lib/trust/store.ts';
import { TrustLoader } from '../src/lib/trust/loader.ts';
import { readFileSync } from 'node:fs';

let checks = 0;
function ok(condition, name) {
  checks++;
  assert.ok(condition, name);
  console.log(`   ✓ ${name}`);
}

// ─── Certificates to populate the fixtures with ──────────────────────────────

function makeCert({ cn, org, country = 'ES', days = 3650, issuer = null, ca = false }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + days * 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: org }];
  // `country: null` builds a DN with no C=, which is what forces the loader
  // onto the thumbprint index: there is no territory to guess from.
  if (country) attrs.push({ name: 'countryName', value: country });
  cert.setSubject(attrs);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: ca }, { name: 'keyUsage', digitalSignature: true, keyCertSign: ca }]);
  cert.sign(issuer ? issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

/**
 * A certificate as the verifier will ever see one: read back from DER.
 *
 * Not a detail. forge computes a DN's hash one way when you build a
 * certificate with setSubject() and another way when it parses one, and its
 * CA store looks issuers up by that hash — so a freshly built certificate
 * does not chain to a store built from PEM, while the same certificate read
 * out of a signed PDF does. Everything the store judges comes out of a CMS,
 * so everything here goes through the same door.
 */
const parsed = (cert) => forge.pki.certificateFromPem(forge.pki.certificateToPem(cert));

const derOf = (cert) => forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
const b64Of = (cert) => forge.util.encode64(derOf(cert));
const shaOf = (cert) => {
  const md = forge.md.sha256.create();
  md.update(derOf(cert));
  return md.digest().toHex();
};

// ─── 1 · Extraction from a national list ─────────────────────────────────────

console.log('1. Extraction from a trusted list');

const esCa = makeCert({ cn: 'AC Ejemplo Ciudadanos', org: 'Ejemplo SA', ca: true });
const esTsa = makeCert({ cn: 'Ejemplo TSA', org: 'Ejemplo SA', ca: true });
const esWeb = makeCert({ cn: 'AC Ejemplo Web', org: 'Ejemplo SA', ca: true });
const esGone = makeCert({ cn: 'AC Retirada', org: 'Antigua SL', ca: true });

const service = ({ name, type, cert, status = 'granted', since = '2020-01-01T00:00:00Z', uses = [] }) => `
      <TSPService><ServiceInformation>
        <ServiceTypeIdentifier>${type}</ServiceTypeIdentifier>
        <ServiceName><Name xml:lang="en">${name}</Name></ServiceName>
        <ServiceDigitalIdentity><DigitalId><X509Certificate>${b64Of(cert)}</X509Certificate></DigitalId></ServiceDigitalIdentity>
        <ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/${status}</ServiceStatus>
        <StatusStartingTime>${since}</StatusStartingTime>
        <ServiceInformationExtensions>${uses.map((u) => `<URI>http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/${u}</URI>`).join('')}</ServiceInformationExtensions>
      </ServiceInformation></TSPService>`;

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<TrustServiceStatusList>
  <SchemeInformation>
    <TSLSequenceNumber>42</TSLSequenceNumber>
    <ListIssueDateTime>2026-06-01T00:00:00Z</ListIssueDateTime>
    <NextUpdate><dateTime>2026-12-01T00:00:00Z</dateTime></NextUpdate>
  </SchemeInformation>
  <TrustServiceProviderList>
    <TrustServiceProvider>
      <TSPInformation>
        <TSPName><Name xml:lang="en">Ejemplo S.A. &amp; Co</Name></TSPName>
        <TSPTradeName><Name xml:lang="en">Ejemplo</Name></TSPTradeName>
      </TSPInformation>
      <TSPServices>
        ${service({ name: 'Qualified certificates for natural persons', type: 'http://uri.etsi.org/TrstSvc/Svctype/CA/QC', cert: esCa.cert, uses: ['ForeSignatures'] })}
        ${service({ name: 'Qualified time-stamps', type: 'http://uri.etsi.org/TrstSvc/Svctype/TSA/QTST', cert: esTsa.cert })}
        ${service({ name: 'Website certificates', type: 'http://uri.etsi.org/TrstSvc/Svctype/CA/QC', cert: esWeb.cert, uses: ['ForWebSiteAuthentication'] })}
        ${service({ name: 'Certificate revocation service', type: 'http://uri.etsi.org/TrstSvc/Svctype/Certstatus/OCSP/QC', cert: esCa.cert })}
      </TSPServices>
    </TrustServiceProvider>
    <TrustServiceProvider>
      <TSPInformation><TSPName><Name xml:lang="en">Antigua S.L.</Name></TSPName></TSPInformation>
      <TSPServices>
        ${service({ name: 'Withdrawn qualified certificates', type: 'http://uri.etsi.org/TrstSvc/Svctype/CA/QC', cert: esGone.cert, status: 'withdrawn', since: '2024-05-01T00:00:00Z', uses: ['ForeSignatures'] })}
      </TSPServices>
    </TrustServiceProvider>
  </TrustServiceProviderList>
</TrustServiceStatusList>`;

const extracted = extractAnchors(fixture, 'https://example.test/TSL.xml');
ok(extracted.source.sequence === 42, 'the sequence number, the issue date and the next update come out of the header');
ok(extracted.source.issued === '2026-06-01T00:00:00Z' && extracted.source.nextUpdate === '2026-12-01T00:00:00Z', 'and they are the ones the list declares');
ok(extracted.providers === 2, 'both providers are counted');
ok(extracted.anchors.length === 3, `three anchors kept, not four: ${extracted.anchors.length}`);
ok(!extracted.anchors.some((a) => a.sha256 === shaOf(esWeb.cert)), 'the website CA is left out — it signs servers, not people');
ok(!extracted.anchors.some((a) => a.sha256 === shaOf(esCa.cert) && a.services.some((s) => s.type === undefined)), 'the OCSP service is left out: it is not an issuing authority');
const ca = extracted.anchors.find((a) => a.sha256 === shaOf(esCa.cert));
ok(ca?.services[0].provider === 'Ejemplo S.A. & Co', 'the provider name is unescaped');
ok(ca?.services[0].tradeName === 'Ejemplo' && ca.services[0].uses.includes('signatures'), 'with its trade name and its declared use');
ok(ca?.key === 'rsa' && /CN=ac ejemplo ciudadanos/.test(ca.subject ?? ''), `and its key algorithm and subject, read out of the DER: ${ca?.key} ${ca?.subject}`);
const gone = extracted.anchors.find((a) => a.sha256 === shaOf(esGone.cert));
ok(gone?.services[0].status === 'withdrawn' && gone.services[0].statusSince === '2024-05-01T00:00:00Z', 'a withdrawn service keeps its status and the date it lost it');

console.log('2. A list written with namespace prefixes');
const prefixed = fixture
  .replace(/<(\/?)(TrustServiceProvider|TSPService|ServiceInformation|ServiceTypeIdentifier|ServiceName|ServiceStatus|StatusStartingTime|X509Certificate|TSPName|Name|TSLSequenceNumber|ListIssueDateTime|NextUpdate|dateTime)\b/g, '<$1ns3:$2');
ok(prefixed.includes('<ns3:TrustServiceProvider>'), 'the fixture really is prefixed');
const fromPrefixed = extractAnchors(stripNamespaces(prefixed), 'https://example.test/TSL.xml');
ok(fromPrefixed.anchors.length === 3 && fromPrefixed.source.sequence === 42, 'and it yields exactly the same three anchors');
ok(fromPrefixed.anchors.find((a) => a.sha256 === shaOf(esCa.cert))?.services[0].service === 'Qualified certificates for natural persons', 'including the English service name, so xml:lang survived the stripping');

console.log('3. A list with nothing in it is a failure, not an empty store');
let refused = false;
try {
  extractAnchors('<TrustServiceStatusList><TSLSequenceNumber>1</TSLSequenceNumber></TrustServiceStatusList>', 'https://example.test/empty.xml');
} catch {
  refused = true;
}
ok(refused, 'extraction throws rather than writing a file that trusts nobody');

// ─── 4 · The loader: only the countries the document needs ───────────────────

console.log('4. The loader fetches one country, not thirty');

const dnKeyOf = (cert) => cert.subject.attributes.map((a) => `${a.shortName ?? a.type}=${String(a.value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`).join('/');
const anchorOf = (cert, service) => ({ sha256: shaOf(cert), subject: dnKeyOf(cert), key: 'rsa', pem: forge.pki.certificateToPem(cert), services: [service] });
const listed = (provider, type = 'CA/QC') => ({ provider, tradeName: null, service: `${type} of ${provider}`, type, status: 'granted', statusSince: '2020-01-01T00:00:00Z', uses: ['signatures'] });

const ptCa = makeCert({ cn: 'AC Exemplo', org: 'Exemplo Lda', country: 'PT', ca: true });
// Listed in Portugal, but its DN says so nowhere: only the index can place it.
const placeless = makeCert({ cn: 'Autoridade Sem País', org: 'Exemplo Lda', country: null, ca: true });
const files = {
  'index.json': {
    lotl: 'https://ec.europa.eu/tools/lotl/eu-lotl.xml',
    generatedAt: '2026-09-01T00:00:00Z',
    territories: {
      es: { territory: 'ES', sequence: 42, anchors: 1, retrievedAt: '2026-09-01T00:00:00Z', crossChecked: true },
      pt: { territory: 'PT', sequence: 7, anchors: 1, retrievedAt: '2026-09-01T00:00:00Z' },
      sk: { territory: 'SK', unavailable: 'the list is published over plain HTTP' },
    },
  },
  'es.json': { territory: 'ES', source: {}, anchors: [anchorOf(esCa.cert, listed('Ejemplo SA'))] },
  'pt.json': { territory: 'PT', source: {}, anchors: [anchorOf(ptCa.cert, listed('Exemplo Lda')), anchorOf(placeless.cert, listed('Exemplo Lda'))] },
  'thumbprints.json': { generatedAt: '2026-09-01T00:00:00Z', byThumbprint: { [shaOf(ptCa.cert)]: 'pt', [shaOf(placeless.cert)]: 'pt' } },
};

function fakeFetch(log) {
  return async (url) => {
    const name = String(url).replace('/trust/', '');
    log.push(name);
    if (!(name in files)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => files[name] };
  };
}

const spanish = makeCert({ cn: 'Persona Física', org: 'Nadie', country: 'ES', issuer: esCa, days: 365 });
let log = [];
let loader = new TrustLoader({ fetch: fakeFetch(log) });
let view = await loader.view([parsed(spanish.cert)]);
ok(log.join() === 'index.json,es.json', `only the index and Spain were downloaded: ${log.join(' ')}`);
ok(view.anchors.length === 1 && view.loaded.join() === 'ES', 'and the view holds Spain alone');
let verdict = judgeTrust(parsed(spanish.cert), [], view, new Date(), forSignatures);
ok(verdict.trusted && verdict.judged && verdict.service?.provider === 'Ejemplo SA', 'the Spanish certificate is trusted, and the provider is named');
ok(verdict.territory === 'ES', 'with the territory whose list settled it');

console.log('5. A second document reuses what is already in memory');
const alsoSpanish = makeCert({ cn: 'Otra Persona', org: 'Nadie', country: 'ES', issuer: esCa, days: 365 });
log.length = 0;
await loader.view([parsed(alsoSpanish.cert)]);
ok(log.length === 0, 'nothing was downloaded again');

console.log('6. A territory we refuse to fetch is NOT JUDGED, not "not listed"');
const slovak = makeCert({ cn: 'Slovenská Osoba', org: 'Nikto', country: 'SK', days: 365 });
log = [];
loader = new TrustLoader({ fetch: fakeFetch(log) });
view = await loader.view([parsed(slovak.cert)]);
ok(!log.includes('sk.json'), 'the Slovak list is not even attempted');
ok(view.unavailable.SK === 'the list is published over plain HTTP', 'the view carries the reason the index gave');
verdict = judgeTrust(parsed(slovak.cert), [], view, new Date(), forSignatures);
ok(verdict.judged === false && verdict.trusted === false, 'the verdict is not judged');
ok(/plain HTTP/.test(verdict.reason ?? ''), `and it says why: ${verdict.reason}`);
ok(!/not on the trusted list/.test(verdict.reason ?? ''), 'never claiming the certificate was ruled out');

console.log('7. A certificate with no country falls back to the thumbprint index');
// Nothing in this chain names a territory. The only clue is that the issuing
// CA the signature carries is itself an anchor, and the index knows where.
const anonymous = makeCert({ cn: 'Sem País', org: 'Ninguém', country: null, issuer: placeless, days: 365 });
log = [];
loader = new TrustLoader({ fetch: fakeFetch(log) });
view = await loader.view([parsed(anonymous.cert), parsed(placeless.cert)]);
ok(log.includes('thumbprints.json') && log.includes('pt.json'), `the fallback found Portugal: ${log.join(' ')}`);
ok(view.loaded.join() === 'PT', 'and loaded that list alone');
verdict = judgeTrust(parsed(anonymous.cert), [parsed(placeless.cert)], view, new Date(), forSignatures);
ok(verdict.trusted && verdict.judged, 'and the certificate is judged trusted through it');

console.log('8. Offline: the maths still stand, the issuer is not judged');
const offline = new TrustLoader({ fetch: async () => { throw new Error('network down'); } });
let threw = false;
await offline.view([parsed(spanish.cert)]).catch(() => { threw = true; });
ok(threw, 'the loader refuses to invent an empty store, so the verifier leaves trust unreported');

// ─── 9 · The real store, two countries ───────────────────────────────────────

console.log('9. The real store: Spain and Germany resolve to their own provider');

// The loader against the files on disk, exactly as the browser would fetch
// them from /trust/. No network, but the real 3409 anchors.
const fromDisk = async (url) => {
  const name = String(url).replace('/trust/', '');
  const path = new URL(`../public/trust/${name}`, import.meta.url);
  try {
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

/**
 * An anchor certificate judged as if it were the leaf.
 *
 * This is the honest test available without a real qualified certificate from
 * each country: a listed issuing CA must chain to itself in its own
 * territory's list, be reported as granted, and name its provider. It proves
 * the whole path — the `C=` of the DN picks the country, the loader fetches
 * that file and no other, and the judgement finds the service — against real
 * data. What it cannot prove is an end-entity certificate from a citizen,
 * which nobody can obtain but its holder.
 */
async function judgeListedAuthority(cc, pick) {
  const store = JSON.parse(readFileSync(new URL(`../public/trust/${cc}.json`, import.meta.url), 'utf8'));
  const anchor = store.anchors.find(pick);
  assert.ok(anchor, `no matching anchor in ${cc}.json`);
  const cert = forge.pki.certificateFromPem(anchor.pem);
  const log = [];
  const loader = new TrustLoader({ fetch: async (u) => (log.push(String(u).replace('/trust/', '')), fromDisk(u)) });
  const view = await loader.view([cert]);
  const at = new Date(Math.min(cert.validity.notAfter.getTime() - 1000, Date.now()));
  return { anchor, cert, view, log, verdict: judgeTrust(cert, [], view, at, forSignatures) };
}

const es = await judgeListedAuthority('es', (a) => a.sha256 === '601293ca20b09a03295d196256c6953ff9eba811db8e3ce140413c1bffe9a869');
ok(es.log.join() === 'index.json,es.json', `AC FNMT Usuarios pulled Spain's list and nothing else: ${es.log.join(' ')}`);
ok(es.verdict.trusted && es.verdict.judged, 'and it is on the trusted list');
ok(/FNMT/.test(es.verdict.service?.provider ?? ''), `named by its provider: ${es.verdict.service?.provider}`);

const de = await judgeListedAuthority('de', (a) => a.key === 'rsa' && a.services.some((svc) => svc.type === 'CA/QC' && svc.status === 'granted' && /D-Trust|Bundesdruckerei/i.test(svc.provider)));
ok(de.log.join() === 'index.json,de.json', `a German authority pulled Germany's list and nothing else: ${de.log.join(' ')}`);
ok(de.verdict.trusted && de.verdict.judged, 'and it is on the trusted list');
ok(de.verdict.territory === 'DE' && /D-Trust|Bundesdruckerei/i.test(de.verdict.service?.provider ?? ''), `named by its provider: ${de.verdict.service?.provider}`);

const index = JSON.parse(readFileSync(new URL('../public/trust/index.json', import.meta.url), 'utf8'));
const held = Object.values(index.territories).filter((t) => !t.unavailable).length;
ok(held >= 28, `${held} of the ${Object.keys(index.territories).length} territories have a list`);
ok(index.territories.sk?.unavailable, `and Slovakia says why it does not: ${index.territories.sk?.unavailable}`);
ok(index.territories.es?.crossChecked === true, 'Spain is marked as cross-checked against the FNMT');

console.log('10. An authority whose key this verifier cannot read is NOT ruled out');

// The real Spanish list holds 43 elliptic-curve authorities that node-forge
// refuses to parse. A certificate issued by one of them must never come back
// as "not on the trusted list": it is on it, and we simply cannot follow the
// chain. The fixture reproduces that shape — an anchor whose PEM forge will
// not read, with the subject the store recorded from the DER.
const ecCa = makeCert({ cn: 'AC Curva Elíptica', org: 'Curvas SA', country: 'ES', ca: true });
const ecLeaf = makeCert({ cn: 'Persona Con Curva', org: 'Nadie', country: 'ES', issuer: ecCa, days: 365 });
const ecAnchor = {
  sha256: shaOf(ecCa.cert),
  subject: dnKeyOf(ecCa.cert),
  key: 'ec',
  pem: '-----BEGIN CERTIFICATE-----\nbm90IHNvbWV0aGluZyBmb3JnZSB3aWxsIHBhcnNl\n-----END CERTIFICATE-----',
  services: [listed('Curvas SA')],
};
const ecView = { anchors: [ecAnchor], loaded: ['ES'], unavailable: {} };
verdict = judgeTrust(parsed(ecLeaf.cert), [], ecView, new Date(), forSignatures);
ok(verdict.judged === false, 'the verdict is not judged');
ok(/elliptic-curve key, which this verifier cannot check/.test(verdict.reason ?? ''), `and it says exactly why: ${verdict.reason}`);
ok(verdict.service?.provider === 'Curvas SA', 'while still naming the provider it is listed under');
ok(!/not on the trusted list/.test(verdict.reason ?? ''), 'and never claiming it was ruled out');

// The same store, a certificate from nobody: that one IS ruled out.
verdict = judgeTrust(parsed(makeCert({ cn: 'Nadie', org: 'Nadie', country: 'ES', days: 365 }).cert), [], ecView, new Date(), forSignatures);
ok(verdict.judged === true && /not on the trusted list/.test(verdict.reason ?? ''), 'a certificate from nobody is still ruled out, as it should be');

console.log('11. Outside the Union is an answer, not a gap');

// The default time-stamping authority is DigiCert, in the United States.
// There is no US trusted list because eIDAS qualification does not exist
// there — so "not qualified" is a fact, and reporting it as "not judged"
// would be hiding behind uncertainty we do not actually have.
const american = makeCert({ cn: 'DigiCert Timestamp Responder', org: 'DigiCert', country: 'US', days: 365 });
log = [];
loader = new TrustLoader({ fetch: fakeFetch(log) });
view = await loader.view([parsed(american.cert)]);
ok(!log.includes('us.json'), 'no list is looked for');
ok(view.outside.includes('US'), 'the territory is reported as outside the lists');
verdict = judgeTrust(parsed(american.cert), [], view, new Date(), forTimestamps);
ok(verdict.judged === true && verdict.trusted === false, 'and the verdict is settled: not qualified');
ok(/US, which the EU trusted lists do not cover/.test(verdict.reason ?? ''), `saying why: ${verdict.reason}`);

console.log('12. How much of Europe this verifier can actually check');
let readable = 0;
let unreadable = 0;
for (const cc of Object.keys(index.territories)) {
  if (index.territories[cc].unavailable) continue;
  for (const a of JSON.parse(readFileSync(new URL(`../public/trust/${cc}.json`, import.meta.url), 'utf8')).anchors) {
    if (a.key === 'rsa') readable++;
    else unreadable++;
  }
}
ok(readable + unreadable === Object.values(index.territories).reduce((n, t) => n + (t.anchors ?? 0), 0), `${readable + unreadable} anchors across the store`);
ok(unreadable > 0 && readable / (readable + unreadable) > 0.9, `${readable} chain-checkable, ${unreadable} on a curve this verifier cannot follow (${((unreadable / (readable + unreadable)) * 100).toFixed(1)}%)`);

console.log(`\n✅ ${checks} checks passed.`);
