# Durable session revocations (protocol 1)

This draft is stacked on CI/CD preparation PR #14 at `29b3f60b298fa9ce3892feb50a3f514b14534cc0`. It fixes forgotten revocations; it does not authorize a deployment, release or infrastructure activation. PR #67 and its closed publication/return gates remain intact.

`SIGNDROP_REVOCATION_DB` must name an initialized SQLite file in a persistent private directory owned by runtime uid 10001. Node 24 is required; the built-in `node:sqlite` API is a release candidate in Node 24.15+. No dependency, credential or secret rotation is added. PDFs, certificates, accounts and the browser vault remain outside this store.

The state contains the first-cut timestamp, one opaque subject/timestamp per revoked person and short-lived logout replay ids. Protocol 1 keys are exact UTF-16LE code-unit BLOBs, without Unicode normalization; timestamps are integer Unix milliseconds. Subject marks are retained without time-based deletion, so moving a clock backwards cannot revive a mark. Repeated revocation takes the maximum timestamp. SQLite serializes writers and commits each mark and replay id together with `synchronous=FULL`; sessions use a fresh transaction with a write probe, so an unwritable store also denies account access. No per-process cache or memory fallback exists. A 200 logout response follows commit. A storage error returns 503 and leaves a failed transaction retryable; an already committed replay returns 400 with its revocation intact.

Missing, empty, unreadable, corrupt or unsupported state denies account sessions. Readiness retains the existing four-field JSON response; `session` now also requires a valid writable store. Production refuses to listen unless state is ready. Public verification and existing guest signatures do not consult the store while a running service is degraded. Production restart with missing state fails before serving any routes; this is deliberate.

## First cut — supervised and not activated

1. Later, under separate deployment authorization, stop the old process and isolate its memory-only image from admission/return.
2. Provision a private persistent local volume for uid 10001. The image contains an empty `/var/lib/signdrop` directory with the appropriate owner/mode for a new Docker named volume; no host permission change is performed by this draft. Mount the volume at that path read/write; keep the application root read-only. Do not use tmpfs or an anonymous volume for auth state.
3. Run the candidate image's `node init-revocations.js --new` once, with `SIGNDROP_REVOCATION_DB=/var/lib/signdrop/revocations.sqlite` and the new volume attached. This command exclusively creates a new file, creates schema 1, persists the cutoff and fsyncs the directory. It refuses an existing or partially created file. Normal startup never creates or migrates state.
4. Start the candidate with the same volume and existing secret. All account cookies issued at or before initialization are rejected, including marks lost from the old process. Users must sign in again. Cookies without an explicit `iat` are also rejected. Existing guest links retain their signature and expiry because the secret is unchanged.
5. Validate health, a fresh account session, a signed logout notice, preserved denial after recreation, unaffected users, guest access and public verification before declaring a baseline. Capture the exact enforcing digest and state protocol in infrastructure admission.

The cutoff is an intentional first-cut consequence, not recovery of the old in-memory marks. Do not initialize over old state, restore an older snapshot during a version return, or infer cookie issue time from a different session TTL.

## Return and recovery

Only admit and return to a digest that **enforces** `sealed-session-revocations-v2` and `browser-and-revocations-sqlite-v1` protocol 1, preserving the same volume, origin and existing signing secret. A matching label alone is insufficient: the enforcing binary must pass the same revocation rehearsal. Memory-only `0.1.3` and PR #14's original image are incompatible even though their cookies look the same. Default automatic return stays disabled; this draft does not provide a production baseline or a tested pair of different released versions.

The CI OCI rehearsal uses the same exact enforcing image, recreates its container with a persistent fixture volume, introduces a configuration failure, then returns to the enforcing configuration and proves the same cookie remains denied. This proves the protocol-preserving image-only operation; it does not claim compatibility with an untested future release. Before future cross-version return, rehearse the real candidate/baseline pair on a copy of auth state. Schema changes require an explicit compatibility review; startup refuses every unsupported schema and never migrates it.

The volume is security state and needs a real backup policy in the later infra implementation. SQLite DELETE journal and FULL synchronization permit crash recovery, but a backup must be taken with the app stopped or with SQLite's backup API, including any recovery journal. A restored old copy could forget newer marks. Restore is a separate supervised recovery requiring a new account-session cutoff; it must never be part of normal image return. Private disk tampering, disappearance of the entire persistent volume, and hardware/fsync failures are outside what an image-only return can recover automatically.

The provider must actually send valid back-channel notices; this patch does not add that integration or widen support for sid-only logout. A sid-only token retains the previous acknowledgment behavior and creates no subject mark. Provider account deletion without a notice remains bounded by cookie expiry.
