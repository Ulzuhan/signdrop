# Contributing

## The rule that matters

**Whatever the README claims, a test measures.** This project exists because
signing tools tend to promise more than they check: the version before this
one reported "integrity seal valid" if the PDF's metadata contained the word
SignDrop, which anyone can write. If a change adds a promise, it adds the
test that would catch the promise becoming false — and where the claim is
about a standard, the test contrasts against something that is not ours:
`pdfsig` from poppler, `qpdf --check`, a real time-stamping authority.

Anything that cannot be measured does not get promised.

## Running it

```
npm ci                 # postinstall copies pdf.js's worker and maps into public/
npm run dev            # http://localhost:3466
```

`SIGNDROP_SESSION_SECRET` is needed for sessions; without it the workspace
cannot be reached, though `/verify` works. `openssl rand -hex 32`.

## The suites

```
npm test               # unit specs, then the five behaviour suites
npm run test:unit      # vitest, src/**/*.test.ts
npm run test:pades     # PKCS#12, PAdES signing, the RFC 3161 request, templates
npm run test:verify    # the verifier, against what it exists to catch
npm run test:trust     # the EU trusted lists, extraction and loading
npm run test:incremental   # the widget, and signing an already-signed PDF
npm run build          # the four below start the built server
npm run test:acceso    # who gets in
npm run test:backchannel   # OIDC round trip against a provider that really signs
npm run test:csp       # the content policy, and no inline styles coming back
npm run test:e2e       # Playwright, desktop and phone
                       #   (npx playwright install chromium, once)
npm run lint
npx tsc --noEmit       # after the build: Next generates the route types
```

The behaviour suites are plain scripts rather than specs on purpose: they read
top to bottom as an argument about what the code does, and their output is
the documentation of what was checked. The unit specs cover the pure pieces
underneath.

## Shape of the code

- **`src/lib/` knows nothing about React, and only `auth/` and
  `request-origin.ts` know about Next** — the cookies and the request type.
  Everything about PDF, CMS, ASN.1, time-stamping and trust lives there, is
  isomorphic, and is tested in Node with the same code that runs in the
  browser. Routes and components are thin.
- **Errors are results, not exceptions.** A signature that cannot be decoded
  is a verdict with a reason. `any` is not used.
- **No URL of anybody's deployment in the source we write.** This is an MIT
  repository: a default pointing at our DocDrop, or our domain in the audit
  sheet, ships our infrastructure to everyone who clones it. If a feature
  needs an address, it comes from the environment, and without it the feature
  is simply absent. The one exception is the generated KaiCorp chrome
  (`kaicorp-*.tsx`, synced from the kaicorplabs repository), whose service
  links sit behind `KAICORP_FOOTER_LINKS` and stay off unless a deployment
  turns them on. The time-stamping default, DigiCert, is not ours; ADR 4 says
  why it is there.
- **No inline styles.** They are classes with an `sd-` prefix in
  `signdrop-workspace.css`; `npm run test:csp` fails on the next one. The
  exception is genuinely computed geometry.
- **Comments explain why, not what.** Especially where the code looks wrong
  and is not.

## Commits

One change per commit, and a message that explains the reasoning — what was
broken, what it cost, why this fix and not the obvious one. A commit that only
says what the diff already shows is a commit that has not been thought about.

## Decisions

Anything that closes off an alternative goes in `docs/decisions/` as a short
ADR. Four are already there and they are the shape to follow.
