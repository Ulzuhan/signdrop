# 2. Trust comes from the EU trusted lists, and nowhere else

*2 September 2026. Accepted.*

## Context

`/verify` has to answer a question a reader actually has: *is this signature
worth anything?* Checking the maths is necessary and not sufficient — a
self-signed certificate produces a signature that verifies perfectly and
means nothing beyond "these bytes have not changed".

Deciding whether an issuer is a qualified provider needs a list, and there
were three ways to get one:

1. Ship the operating system's or the browser's root store.
2. Scrape the providers' own sites, starting with the FNMT's.
3. Walk the EU List of Trusted Lists.

## Decision

The trusted lists, all thirty of them: the twenty-seven member states plus
Iceland, Liechtenstein and Norway, reached from the LOTL that the Commission
publishes over HTTPS. `scripts/update-trust-store.mjs` writes one file per
territory under `public/trust/`, and the loader downloads only the territories
a document's certificates point at.

A list that cannot be fetched **safely** is not fetched. Slovakia publishes
over plain HTTP, so its anchors are refused and the index records why.

## Consequences

**Three verdicts, never two.** *On the trusted list*, *not on it*, and *not
judged* — and the third is the one that keeps the other two honest. A Slovak
qualified certificate is not judged, with the reason; a certificate from
outside the Union is definitively not qualified, because qualification does
not exist there; a certificate whose issuer signs with an elliptic-curve key
this verifier cannot follow is *listed and uncheckable*, naming the provider.
None of those is allowed to come out as "not on the trusted list", which
would be false.

**The store is data in the repository**, refreshed monthly by a workflow that
opens a pull request. The diff is the change management: an added anchor is a
provider gaining a service, a changed status is one losing it. It never
pushes to main.

**The Spanish list is cross-checked** against the certificates the FNMT
publishes on `cert.fnmt.es`, and the run refuses to write `es.json` if
"AC FNMT Usuarios" is missing from what was extracted or does not verify
against the published root. It is the one list this house can check by hand.

**Eight megabytes of certificates.** They are static assets fetched on demand
— a Spanish document downloads `es.json` and nothing else — never part of any
bundle.

## Alternatives

**The OS or browser root store.** Rejected: it answers a different question.
Those roots are for authenticating servers, and a CA fit to vouch for a web
server is not thereby a qualified provider of signature certificates.

**The providers' own sites.** Rejected: no common format, no common status
vocabulary, and no way to learn that a service was withdrawn.
