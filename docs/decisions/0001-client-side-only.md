# 1. The document never reaches the server

*2 September 2026. Accepted.*

## Context

Every hosted signing product works the same way: you upload the contract, it
lives on their disk, and their promise is that they will look after it. That
promise is the product. It is also unfalsifiable from outside — you cannot
check whether the file was copied, indexed or read.

SignDrop could have been built that way. Server-side signing is easier: one
implementation of PAdES instead of one that has to run in a browser, no
worrying about a fifty-megabyte file in a tab, key material somewhere you
control.

## Decision

The document is opened, stamped, signed and sealed in the browser. The server
receives it never, stores it never, and could not produce it if asked.

Concretely: no upload endpoint, no volume, no database, no accounts table.
The only durable state anywhere is in the visitor's own browser: a sealed
cookie, and what they chose to remember there.

## Consequences

**What it buys.** The privacy claim is structural rather than a policy: there
is nothing to subpoena, nothing to leak and nothing to back up. It makes
SignDrop the cheapest of this platform's services to operate — no backups, no
`borrar-persona`, no data to migrate.

**What it costs.**

- PAdES has to be implemented against node-forge and WebCrypto, and it has to
  be fast enough for a real contract in a real tab. It is: a fifty-megabyte
  document signs in about half a second (measured by hand, not by the suite),
  but only after the CMS was assembled by hand rather than through
  `forge.pkcs7`, which serialised and hashed the whole file three times.
- There is nowhere to keep a revocation list, so back-channel logout lives in
  process memory and a restart forgets it. Written up in
  `src/lib/auth/revocations.ts` rather than hidden.
- There is nowhere to keep a guest link either, so an invitation is a signed
  token that cannot be revoked individually. See ADR 3.
- "Send it to the other party" cannot be a server-side flow. DocDrop exists
  for moving files and the two are meant to be used together.
- Whatever the page can do, script running in the page can do. The content
  policy is load-bearing here in a way it would not be for a server-side
  product.

## Alternatives

**Sign on the server.** Rejected: it is a different product, one whose central
claim is a promise instead of an arrangement.

**Sign in the browser but keep the file for convenience.** Rejected for being
the worst of both — all of the liability, none of the argument.
