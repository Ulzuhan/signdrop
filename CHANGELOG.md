# Changelog

Kept by hand, in the order things happened, with the reasoning where it is
not obvious. Versions follow [semver](https://semver.org/); `0.x` until what
is built justifies more.

## [Unreleased]

### Fixed

- **The environment example named a variable the code never reads.**
  `.env.example` said `SIGNDROP_OIDC_DISCOVERY_URL`; the code reads
  `SIGNDROP_OIDC_ISSUER`. A copy of the 0.1.1 example configured no provider
  and said nothing about it. The example compose file had the same variable
  and one more the code does not read; it now passes the ones it does.
- **The example compose file pointed at our DocDrop by default**, which is the
  one thing this repository promises not to do. The default is gone, and the
  footer links to the KaiCorp services are off unless a deployment turns them
  on.
- **The environment example shipped a secret that passed the length check.**
  Sixty-four zeros, which `cp .env.example .env` would have started production
  with, without a word. The value is empty now and says why.
- **The documentation claimed more than the code did.** "No deployment's URL
  in the source" and "nothing has a default pointing at anybody's
  infrastructure" were both false: the shared footer lists the house's
  services, and the time-stamping authority defaults to DigiCert. "Plain HTTP
  nowhere else" left out the OIDC token exchange over an internal base.
  "`src/lib/` knows nothing about Next" left out the cookies. Each now says
  what is there; the DocDrop hand-off is documented as fixed at build time,
  which is what it is; and the half-second figure for a fifty-megabyte
  contract says it was measured by hand.

## [0.1.1] — 2026-09-02

### Fixed

- **The content policy left Safari with no page.**
  `upgrade-insecure-requests` was sent unconditionally. Chromium exempts
  loopback from it; WebKit does not, so served over plain http every
  stylesheet, font and script chunk was rewritten to `https://` and died in a
  TLS handshake. Anybody self-hosting behind a plain-http reverse proxy was
  serving a broken page to every Safari visitor. The directive now goes out
  only when the request arrived over https, and a test asserts it does not
  when it did not.

  0.1.0 shipped with this. It was tagged before the browser suite finished,
  which is the mistake underneath the bug — the tag is left where it is
  rather than moved, so the image published under it keeps meaning what it
  meant.

## [0.1.0] — 2026-09-02

The first version whose promises are all measured. What came before was three
days old, called itself `1.0.0`, and claimed four things it did not do.

### The verifier

- `/verify` checks the maths of every PAdES signature: that the bytes in each
  `/ByteRange` hash to what was signed, that the signature verifies with the
  certificate it carries, whether the certificate was valid at the claimed
  time, and whether the signature covers the whole file. Before this, "valid
  seal" meant the PDF's metadata contained the word *SignDrop*.
- RFC 3161 tokens are verified too: that the imprint is the hash of the
  signature value, and that the authority's own signature holds.
- Certificates are chained to the qualified authorities of **all thirty EU
  trusted lists** — 3,409 anchors — downloading only the territories a
  document points at.
- Three verdicts, never two: on the trusted list, not on it, and **not
  judged**, the last with the reason. A territory whose list we refuse to
  fetch over plain HTTP, or an authority signing with a curve this verifier
  cannot follow, is never reported as "not on the list".

### Signing

- The signature field carries a widget: `/Subtype`, `/Rect`, `/F`, `/P` and an
  appearance, listed in the page's `/Annots`. What the reader sees **is** the
  signature. `pdfsig` no longer warns.
- Signing an already-signed PDF appends an incremental update instead of
  rewriting the file, so the first signature still covers the bytes it signed.
  Both cross-reference styles are written.
- The time-stamp is requested over the signature value and embedded as
  PAdES-B-T. The audit sheet no longer prints the client's clock as a
  certified time.
- A fifty-megabyte contract signs in about half a second, down from fifteen.
  Measured by hand, not by the suite, which asserts only that a
  twelve-megabyte one signs at all: a timing assertion in CI is a flake
  waiting to happen.

### Privacy

- pdf.js's worker, character maps and fonts are served from this origin. They
  came from two CDNs, which meant a third party parsed every document opened
  by a tool whose argument is that nothing leaves the machine.
- The four calligraphic faces are self-hosted by `next/font` instead of
  fetched from Google.
- The time-stamp proxy is rate-limited, checks what comes back is really a
  token, and logs nothing about the body. It was an open proxy.
- No deployment's URL is in the source SignDrop writes any more: the DocDrop
  hand-off, the verifier QR and the audit-sheet footer take theirs from the
  environment or the page's own origin. The shared KaiCorp chrome still lists
  the house's services, behind `KAICORP_FOOTER_LINKS`.

### Identity

- OIDC by discovery, internal base for the token exchange, PKCE, back-channel
  logout with the signature checked against the provider's JWKS, and a sealed
  session of at most 24 hours. Without a session secret the service refuses to
  start.
- Guest invitations: a signed link that lets the other party sign without an
  account. `/verify` needs nothing at all.

### Engineering

- A content policy with a per-request nonce and `strict-dynamic`; 81 inline
  styles became classes, and a test fails on the eighty-second.
- ESLint actually configured (it was reporting nothing), `tsc --noEmit`,
  vitest for the pure modules, and five behaviour suites.
- The interface is in English throughout; it was half Spanish.
