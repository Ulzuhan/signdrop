# 4. The time-stamp goes inside the signature, and it is not qualified

*2 September 2026. Accepted.*

## Context

The version before this one asked a time-stamping authority for a token,
received it, and threw it away. The audit sheet then printed **the client
machine's own clock** under the heading "TSA Certified Time". A reader had no
way to tell that from a real one, and it was worth nothing: a clock the
signer controls is not evidence about when anything happened.

Separately, a free time-stamping authority that Acrobat accepts had to be
chosen, and every candidate has the same two properties: it is not on the EU
trusted lists, and it does not publish an HTTPS endpoint.

## Decision

The token is requested **over the signature value, once the signature
exists**, and embedded as the unsigned attribute `signature-time-stamp` —
PAdES-B-T. The audit sheet no longer prints a certified time at all; it says
the signer's clock is the signer's clock, and that the time-stamp, if there
is one, lives inside the signature where a verifier can check it.

The default authority is DigiCert. `/verify` reports what it is: a valid
RFC 3161 token from an authority in the United States, which the EU trusted
lists do not cover, so **not a qualified time-stamp**.

## Consequences

**The claim shrinks and becomes true.** "Official RFC 3161 time-stamps"
becomes a token a reader can verify, with its authority named and its
qualification status stated. A qualified time-stamp needs a listed provider
and a contract; when there is one, it is one environment variable.

**Plain HTTP is allowed for this call and nowhere else.** DigiCert has no
HTTPS endpoint — nor do Sectigo or SSL.com — and this collides with the rule
that refuses Slovakia's trusted list over HTTP. The two are not the same
question. A trusted list over HTTP is authenticated by nothing, so an
attacker on the wire could insert an anchor and make a forged certificate
look qualified. A time-stamp token authenticates itself: it is signed by the
authority, and the verifier checks both that signature and that the token's
imprint is the hash of *this* signature. On the wire a token can be withheld
or corrupted; it cannot be forged or replayed.

The container's egress therefore has to allow HTTP to the authority, which is
a widening of the platform's rule and is recorded here so it is not mistaken
for an oversight.

**A time-stamp that fails does not become a lie.** If the authority does not
answer, the document is signed without one and says so. If it answers with
something that is not a time-stamp — a captive portal, an error page — the
proxy refuses it rather than letting it be embedded as though it were a
token.

## Alternatives

**FreeTSA.** Has HTTPS, and is a hobby service. For a product about contracts,
no.

**No time-stamp by default.** Rejected: PAdES-B-T is what makes a signature
still meaningful after the signing certificate expires, and most people will
not go and find an authority.

**Wait for a qualified provider.** Rejected as the perfect against the good,
as long as the interface says plainly which one it is.
