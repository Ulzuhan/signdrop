/**
 * Who stopped having access, and from when.
 *
 * Why it exists: the session here is a signed cookie with nothing on the
 * server, so when the provider says someone has lost access there is no
 * session to delete. The cookie is already in their browser and stays valid
 * until it expires on its own. The standard answer is not to start storing
 * sessions — that would mean state for every visitor — but to store the
 * opposite: one mark per person saying "anything issued before this instant
 * no longer counts".
 *
 * IN MEMORY, and this is the one place SignDrop differs from the rest of the
 * house. DocDrop keeps the same list in a file, because DocDrop has a volume
 * to keep it in. SignDrop deliberately has none: it stores no documents, no
 * accounts and no database, which is what makes it the cheapest of the eight
 * to operate. The price is written here rather than hidden: **a restart
 * forgets the marks**, so a session revoked before a deployment would work
 * again afterwards, until its own expiry.
 *
 * That is a smaller hole than it looks. Back-channel logout was never the
 * guarantee — the provider only notifies applications holding a live access
 * token for that session, so an hour later the notice does not arrive at all.
 * The guarantee is that the cookie expires by itself within twelve hours, and
 * that changing SIGNDROP_SESSION_SECRET revokes every session at once. This
 * is the fast lane for the ordinary case: throwing out somebody who is using
 * the tool right now.
 *
 * What it holds is deliberately almost nothing: an opaque identifier and a
 * timestamp. No email, no name, nothing anybody signed. And it is pruned —
 * past the maximum life of a session a mark cannot prevent anything, because
 * the cookie it referred to would have expired anyway.
 */

/** How long a mark is kept. Past this it cannot prevent anything. */
const LIFETIME_MS = 25 * 60 * 60 * 1000;

const marks = new Map<string, number>();

function prune(now: number): void {
  for (const [id, at] of marks) if (now - at > LIFETIME_MS) marks.delete(id);
}

/** Everything issued to this subject before now stops counting. */
export function revoke(subject: string): void {
  const now = Date.now();
  prune(now);
  marks.set(subject, now);
}

/** Was this subject revoked after the moment their cookie was issued? */
export function revokedAfter(subject: string, issuedAt: number): boolean {
  const at = marks.get(subject);
  if (at === undefined) return false;
  if (Date.now() - at > LIFETIME_MS) {
    marks.delete(subject);
    return false;
  }
  return issuedAt <= at;
}

/** Only for the suites. */
export function forgetRevocations(): void {
  marks.clear();
}
