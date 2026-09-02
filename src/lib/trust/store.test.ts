import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { dnKey, territoryOf } from './store';

/**
 * The two small functions the whole trust judgement rests on.
 *
 * `territoryOf` decides which country's list gets downloaded; `dnKey` decides
 * whether an issuer is recognised at all. Both are compared against a value
 * produced by a different program — scripts/update-trust-store.mjs writes the
 * anchor subjects with its own copy of `dnKey` — so a change in either has to
 * be a change in both.
 */
function certificate(attrs: { name: string; value: string }[], issuer = attrs) {
  const keys = forge.pki.rsa.generateKeyPair(512);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 1000);
  cert.validity.notAfter = new Date(Date.now() + 1000);
  cert.setSubject(attrs);
  cert.setIssuer(issuer);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return cert;
}

describe('which territory a certificate belongs to', () => {
  it('reads the issuer by default: the list to consult is the issuer\'s', () => {
    const cert = certificate(
      [{ name: 'commonName', value: 'Persona' }, { name: 'countryName', value: 'ES' }],
      [{ name: 'commonName', value: 'AC' }, { name: 'countryName', value: 'PT' }]
    );
    expect(territoryOf(cert)).toBe('PT');
    expect(territoryOf(cert, 'subject')).toBe('ES');
  });

  it('uppercases, because a DN may not', () => {
    const cert = certificate([{ name: 'commonName', value: 'X' }, { name: 'countryName', value: 'es' }]);
    expect(territoryOf(cert, 'subject')).toBe('ES');
  });

  it('answers null rather than guessing when there is no country', () => {
    expect(territoryOf(certificate([{ name: 'commonName', value: 'X' }]))).toBeNull();
  });

  it('rejects anything that is not two letters', () => {
    const cert = certificate([{ name: 'commonName', value: 'X' }, { name: 'countryName', value: 'ESP' }]);
    expect(territoryOf(cert, 'subject')).toBeNull();
  });
});

describe('reducing a distinguished name', () => {
  const de = (attrs: { name: string; value: string }[]) => dnKey(certificate(attrs).subject.attributes);

  it('keeps the order the DN declares: reordering a DN changes it', () => {
    const a = de([{ name: 'commonName', value: 'A' }, { name: 'organizationName', value: 'B' }]);
    const b = de([{ name: 'organizationName', value: 'B' }, { name: 'commonName', value: 'A' }]);
    expect(a).not.toBe(b);
  });

  it('ignores case and stray whitespace in the values', () => {
    const a = de([{ name: 'commonName', value: 'AC  FNMT   Usuarios' }]);
    const b = de([{ name: 'commonName', value: ' ac fnmt usuarios ' }]);
    expect(a).toBe(b);
  });

  it('produces the same string the store-builder writes', () => {
    // The literal shape both sides agree on. If this changes, so must the
    // `dnKey` copied into scripts/update-trust-store.mjs.
    expect(de([{ name: 'commonName', value: 'AC Ejemplo' }, { name: 'countryName', value: 'ES' }]))
      .toBe('CN=ac ejemplo/C=es');
  });
});
