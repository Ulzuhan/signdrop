# SignDrop

Sign a PDF where it already is.

SignDrop stamps, seals and signs PDF documents **in the browser**. The server
never receives the document, never stores it, and could not produce it if
asked — it holds no files, no accounts and no database. The only thing that
ever leaves the machine is a 32-byte hash, and only if you ask for a
time-stamp.

The signature is the real thing: a PAdES signature that Acrobat validates,
with the certificate chained to the qualified authorities of the EU trusted
lists, and a second signature that does not break the first.

MIT licensed. Part of [KaiCorp Labs](https://kaicorplabs.com).

---

## What it does

**Sign.** Draw your signature, type it in one of four hands, or upload a scan
and have the background taken out. Place it, with initials, dates and fields,
on any page. Load your `.p12` and the placed signature becomes the appearance
of a real PAdES signature field — what a reader sees *is* the signature, and
clicking it in any reader opens the certificate behind it.

**Seal.** An audit sheet with the SHA-256 of the original, the time in UTC and
a QR code that opens the verifier.

**Time-stamp.** An RFC 3161 token requested over the signature value and
embedded inside it, which is what PAdES-B-T means and what keeps a signature
meaningful after the certificate expires.

**Verify.** `/verify` needs no account and never will. It checks the maths of
every signature in a file, the token each carries, and who issued the
certificate — against the trusted lists of all thirty territories the EU
publishes, downloading only the ones a document points at.

## What it does not do, said plainly

- **It does not check revocation.** No OCSP, no CRLs. A certificate revoked
  after issue still verifies here, and the page says the verifier does not
  check this rather than implying otherwise.
- **It cannot check ECDSA or RSA-PSS signatures.** They come back as "cannot
  check", never as invalid. About 7% of Europe's qualified authorities sign
  with elliptic curves, and a certificate issued by one of them is reported as
  *not judged*, naming the provider — never as *not on the trusted list*,
  which would be false.
- **It does not make your signature qualified.** That depends on your
  certificate, which comes from a qualified provider and not from us. The
  default time-stamping authority is not on the EU trusted lists, and
  `/verify` says so rather than letting you assume.
- **It does not keep anything.** Nothing is stored, so nothing is recoverable.

## Three verdicts, not two

The thing this tool is built around: *on the trusted list*, *not on it*, and
**not judged** — the last one with the reason. Slovakia publishes its trusted
list over plain HTTP, so its anchors are refused; a Slovak qualified
certificate therefore comes back as not judged, not as unlisted. A certificate
from outside the Union is a settled *not qualified*, because qualification
does not exist there. An issuer whose key this verifier cannot follow is
*listed and uncheckable*, with the provider named.

Anything else would be a guess wearing a verdict's clothes.

## Running it

```bash
npm ci                 # postinstall copies pdf.js's worker and maps into public/
cp .env.example .env
npm run dev            # http://localhost:3466
```

Signing needs `SIGNDROP_SESSION_SECRET` (`openssl rand -hex 32`) and an OIDC
provider; `/verify` works without either. Everything in `.env.example` is
optional and nothing has a default pointing at anybody's infrastructure: leave
a variable unset and the feature it configures is simply absent.

### With Docker

```bash
docker run --rm -p 3466:3466 \
  -e SIGNDROP_SESSION_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/ulzuhan/signdrop:latest
```

## The trusted lists

`public/trust/` holds one file per territory — 3,409 qualified authorities —
rebuilt from the EU List of Trusted Lists:

```bash
node scripts/update-trust-store.mjs
```

A workflow runs it monthly and opens a pull request when something moved. It
never pushes: a trust store that updates itself unattended is a trust store
nobody is watching. The Spanish list is cross-checked against the certificates
the FNMT publishes on its own site, and the run refuses to write it if that
check fails.

## Checking our work

Every claim above has a test, and the ones about standards are contrasted
against verifiers that are not ours:

```bash
npm test               # unit specs and the five behaviour suites
npm run test:acceso    # who gets in
npm run test:backchannel   # OIDC, against a provider that really signs
npm run test:csp       # the content policy, and no inline styles coming back
```

CI installs `poppler-utils` and `qpdf` and asserts that a document signed here
gets *Signature is Valid* and *Total document signed* out of `pdfsig`, with no
syntax complaints, and passes `qpdf --check` — and that a twice-signed
document gets two valid signatures with the first covering its own revision.

## How it is put together

```
src/lib/          no React, no Next: isomorphic, and tested in Node with the
  pdf/            same code that runs in the browser
  pades/          signer, verifier, and the CMS assembled by hand
  tsa/            RFC 3161 client
  trust/          the store schema, the per-country loader, the judgement
  auth/           OIDC by discovery, sealed sessions, guest links
src/app/          thin routes
public/trust/     one file per territory, plus two indexes
```

Decisions that closed off an alternative are written down in
`docs/decisions/`. The threat model is in `SECURITY.md`.

## Contributing

`CONTRIBUTING.md`. The short version: whatever the README claims, a test
measures it.
