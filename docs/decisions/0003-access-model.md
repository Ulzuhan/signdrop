# 3. An account to sign, nothing to verify, and an invitation for the other party

*2 September 2026. Accepted.*

## Context

The other services on this platform share one model: an account approved
by hand in Authentik, and the whole application behind it. It is consistent,
it is easy to reason about, and applied here it would break the product.

A signing tool has two people in it. One of them starts the contract; the
other receives it, has to sign it, and has to be able to check it afterwards.
Making that second person register for a service they did not choose, in
order to return a document that was sent to them, is where this kind of tool
stops being used.

The opposite — no accounts at all — was the recommendation in the plan, and
was rejected: there is a real cost to running this (quota at a time-stamping
authority) and no way to attribute it.

## Decision

Three doors.

- **`/verify` is public, permanently.** Checking a signature needs no account
  and never will. It reveals nothing: everything happens in the reader's
  browser and the server only serves the page and the trusted lists.
- **The workspace needs a session**, from the house's own provider, with the
  `signdrop` group populated by hand.
- **Anyone with a session can mint an invitation**: a link that lets one other
  person sign, without joining anything.

## Consequences

**The invitation carries itself.** DocDrop solves the same problem with a JSON
file per link — a token, a counter, a revoke button — and can, because a guest
there uploads something and DocDrop has a volume. Here there is nothing to
upload: the link unlocks a tool that runs entirely in the guest's browser. So
the token is an HMAC over its own contents, checked with the session secret,
and SignDrop stays the only service of the eight with no volume, no backup and
no `borrar-persona` (ADR 1).

**A single invitation cannot be revoked.** It expires — 24 hours by default,
7 days at most — or every one of them is revoked at once by rotating
`SIGNDROP_SESSION_SECRET`, which also ends every session. That is a real cost
and it is accepted for a specific reason: what is behind an invitation is not
documents, which the server never has, but quota at a time-stamping
authority. A guest's time-stamps are billed to whoever invited them, so
handing one out is a decision with a price attached.

**Domain separation is load-bearing.** A session cookie and an invitation are
both a base64url payload signed with the same key. Without the `guest.`
prefix inside the HMAC, each would be accepted in place of the other. Two
assertions in the access suite exist only to keep that true.

## Alternatives

**No accounts at all.** Rejected: the time-stamp proxy would be free capacity
for anyone who found the domain.

**The model of the others, unchanged.** Rejected: it leaves the
counterparty outside, and the counterparty is half the product.
