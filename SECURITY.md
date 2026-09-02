# Security

## Reporting

Report a vulnerability privately through GitHub's *Report a vulnerability*
button on the Security tab of this repository. Please do not open a public
issue for anything exploitable.

There is no bounty. There is an answer, and a fix or an honest explanation of
why something is not going to be fixed.

## What SignDrop is, in security terms

A document is opened, stamped, signed and sealed **in the browser**. The
server never receives it, never stores it and could not produce it if
compelled. It holds no accounts, no database and no volume of any kind: the
only state anywhere is a sealed cookie in the visitor's own browser.

That shape decides most of what follows. There is very little on the server
worth attacking, and correspondingly more that depends on the page being what
it claims to be.

## What leaves the machine

Exactly one thing, and only if a time-stamp is asked for: **the SHA-256 of
the signature value**, sent by our server to an RFC 3161 authority. Not the
document, not its hash, not its name, not its length. The authority learns
that somebody wanted a time-stamp and nothing about what for.

Everything else the page loads comes from this origin: the pdf.js worker and
its character maps, the fonts, the trusted lists. There is no CDN, no
analytics and no font service. `connect-src 'self'` is in the content policy
and a test asserts it.

## Threat model

### A malicious PDF

A PDF is a program-shaped format and the parser is the attack surface. pdf.js
runs in a worker, which is where its own sandboxing story lives, and the
worker is served from this origin rather than a CDN — the previous
arrangement meant that whoever controlled `cdnjs` controlled the code that
parsed your contract. Metadata read out of a document is escaped where it is
displayed and is always labelled as what the file claims about itself, never
as a finding.

The verifier never throws on malformed input: a signature it cannot decode is
a verdict with a reason, not an exception, so a hostile file cannot make the
page fail open.

### Abuse of the time-stamp proxy

`/api/tsa` forwards to an authority whose URL comes only from the
environment; nothing in the request can redirect it. It is rate-limited per
account, per invitation-issuer and per IP, checks that the reply really is a
time-stamp token before handing it to the signer, bounds both request and
reply, and logs nothing about the body.

Plain HTTP is permitted **for this one call and nowhere else**, and the
reasoning matters: an RFC 3161 token is signed by the authority and the
verifier checks both that signature and that the token's imprint is the hash
of this signature. An attacker on the wire can withhold or corrupt a token;
they cannot forge or replay one. By contrast a trusted list over plain HTTP
is authenticated by nothing, which is why Slovakia's is refused and reported
as unavailable rather than quietly trusted.

### Key material in the page

A `.p12` is opened with node-forge in the page's memory and the private key
lives there for as long as the tab does. It is never sent anywhere and never
written to disk unless the person explicitly asks for it to be remembered, in
which case it is encrypted with a key derived from their own passphrase.

This is the honest limit of a browser tool: anything that can run script in
the page can reach that key. That is what the content policy exists for —
`script-src` allows a per-request nonce and `'strict-dynamic'`, and no inline
script without one runs.

### Clickjacking and framing

`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `base-uri 'none'`.

### Sessions and invitations

The session is an HMAC-sealed cookie carrying the identity, valid for twelve
hours (clamped to 1–24). Rotating `SIGNDROP_SESSION_SECRET` invalidates every
session and every invitation at once. Back-channel logout from the provider
revokes a live session immediately; the list of revocations is in memory, so
a restart forgets it and the cookie's own expiry becomes the guarantee. This
is written up in `src/lib/auth/revocations.ts`.

Invitations are signed with the same key under a different domain prefix, so
one can never be presented as the other. A single invitation cannot be
revoked: it expires, or every one of them goes at once with the secret. What
is behind an invitation is quota at a time-stamping authority, not documents.

### Supply chain

Dependencies are pinned by `package-lock.json` and the image is built with
`npm ci`. Renovate opens grouped updates weekly and security updates
immediately. The container image is built with provenance and an SBOM and
gated on a Trivy scan.

The trusted lists are rebuilt monthly by a workflow that opens a pull request
and never pushes: a trust store that updates itself unattended is a trust
store nobody is watching. The Spanish list is cross-checked against what the
FNMT publishes on its own site before it is written.

## What SignDrop does not claim

- **It does not check revocation.** Neither OCSP nor CRLs. A certificate
  revoked after it was issued still verifies here, and `/verify` says the
  verifier does not check this rather than implying it does.
- **It cannot check ECDSA or RSA-PSS signatures**, and reports them as
  "cannot check" instead of as invalid. Around 7% of Europe's qualified
  authorities sign with elliptic curves; a certificate issued by one of them
  comes back as *not judged*, naming the provider, never as *not listed*.
- **It does not make a signature qualified.** That depends on the
  certificate, which comes from a qualified provider and not from us. The
  default time-stamping authority is not on the EU trusted lists and
  `/verify` says so.
- **It is not a document store.** Nothing is kept, so nothing can be
  recovered.
