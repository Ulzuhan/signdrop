/**
 * One durable mark per opaque subject, not a session/document database.
 * See docs/durable-revocations.md for initialization and compatible return.
 * There is no memory fallback, automatic creation or destructive migration.
 */
export { revoke, revokedAfter, revocationsReady } from '../../../scripts/revocation-store.js';
