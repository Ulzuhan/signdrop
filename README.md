# SignDrop

**Client-side PDF signing, cryptographic sealing, and document verification.** Zero-knowledge, browser-processed, and tamper-evident.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Uploading confidential contracts, agreements, or NDA documents to third-party electronic signature SaaS platforms exposes sensitive terms to external data processing. **SignDrop** enables users to stamp visual signatures, initials, dates, and form fields into PDF documents, generating an integrity seal with SHA-256 checksums, official RFC 3161 timestamps, and PAdES X.509 digital certificates — entirely inside the user's browser.

---

## 🔒 Privacy & Cryptographic Model

- **100% Client-side PDF Processing**: The original PDF document is parsed, modified, and rendered locally in the browser memory using `pdfjs-dist` and `pdf-lib`. **The document never uploads to any remote server during signing**.
- **PAdES Advanced Electronic Signatures (X.509 PKI)**:
  - Local loading and unlock of `.p12` / `.pfx` digital certificates and private keys entirely in WebAssembly / JS memory.
  - Generates ISO 32000-1 / ETSI EN 319 142 `/ByteRange` detached CMS PKCS#7 digital signatures, natively recognized by **Adobe Acrobat Reader** (*"Signed and all signatures are valid"*).
- **Time Stamping (RFC 3161 TSA)**:
  - Only a 32-byte SHA-256 digest is sent to the Time Stamping Authority, through this instance's `/api/tsa` proxy. The token comes back and is **embedded in the PAdES signature** as the signature-time-stamp attribute (PAdES-B-T), where `/verify` reads the certified time from. A time-stamp needs a certificate signature to live in; without a `.p12`, none is requested.
- **Audit Trail**:
  - Records the SHA-256 of the original document and appends an audit sheet with a QR to this instance's `/verify` page.
  - On its own the sheet is a record, not proof: a PDF cannot carry its own hash. Integrity is provable only through the PAdES signature, which covers the sheet too.
- **Verification Engine (`/verify`)**:
  - Public drag-and-drop page that checks the maths of every PAdES signature in the file — the covered bytes hash to what was signed, the signature verifies with the certificate it carries, the certificate was valid at the claimed time, and whether anything was appended after signing — and of every RFC 3161 token (imprint over the signature, TSA signature). It does **not** validate certificate chains against a trust store, and says so on the page; metadata is shown as what the file claims, never as proof.
- **Reusable Templates Engine**:
  - Save, manage, export, and import stamp placement configurations (JSON format) across sessions.
- **DocDrop hand-off**:
  - A link to a DocDrop instance for sending the signed PDF encrypted end-to-end (shown only when `SIGNDROP_DOCDROP_URL` is set).

---

## ⚡ Core Features

- **Multi-Type Signatures**:
  - Draw signature (smooth vector Bézier canvas with color inks).
  - Type signature (curated typography: *Caveat*, *Dancing Script*, *Great Vibes*, *Playwrite*).
  - Upload signature image (with automatic background removal and contrast thresholding).
- **Document Annotations**: Place text fields, dates, checkboxes, and initials across any page.
- **Multi-page Support**: Page thumbnails sidebar, adaptive zoom, drag-and-drop overlays, and resize handles.
- **Digital Certificates**: Full support for `.p12` / `.pfx` files for advanced PAdES signing.
- **RFC 3161 Time-Stamps**: embedded in the signature, verifiable on `/verify`.
- **Template Store**: Reusable field templates with JSON import / export.
- **PDF Verification Tool (`/verify`)**: checks signatures and time-stamps in the browser; honest about what it cannot check.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS.
- **PDF Engine**: `pdfjs-dist` (client-side rendering) + `pdf-lib` (PDF manipulation and audit sheet generation).
- **Cryptography & PAdES**: `node-forge` (PKCS#12, PKCS#7/CMS, X.509, ASN.1) + Web Crypto API (`crypto.subtle`).
- **UI Components**: KaiCorp theme (*Space Grotesk*, *Inter*, *JetBrains Mono*).
- **Container / Isolation**: `read_only: true`, `cap_drop: [ALL]`, non-root user (`uid 10001`), loopback port binding (`127.0.0.1:3466`).

---

## 🚀 Getting Started

### Local Development

```bash
# Install dependencies
npm install

# Start development server on port 3466
npm run dev

# Run automated test suites (PDF Engine + PAdES + TSA + Templates)
npm test
npm run test:pades

# Build standalone production bundle
npm run build

# A PDF signed with a throwaway certificate, to check with pdfsig / Acrobat
npx tsx scripts/sample-signed-pdf.mjs out.pdf && pdfsig out.pdf
```

### Docker Deployment

```bash
docker compose up -d
```

---

## ⚙️ Environment Variables

| Variable | Description |
|---|---|
| `SIGNDROP_PORT` | Port to listen on (default: `3466`). |
| `SIGNDROP_HOST` | Host binding address (default: `0.0.0.0` or `127.0.0.1`). |
| `SIGNDROP_PUBLIC_HOST` | Explicit public hostname for origin guarding (e.g. `sign.kaicorplabs.com`). |
| `SIGNDROP_SESSION_SECRET` | Secret key for signing session cookies. |
| `SIGNDROP_OIDC_CLIENT_ID` | OIDC Client ID. |
| `SIGNDROP_OIDC_CLIENT_SECRET` | OIDC Client Secret. |
| `SIGNDROP_OIDC_DISCOVERY_URL` | OIDC Issuer Discovery URL (`/.well-known/openid-configuration`). |
| `SIGNDROP_OIDC_REDIRECT_URI` | Public callback URL (e.g. `https://sign.kaicorplabs.com/api/auth/callback`). |
| `SIGNDROP_ENROLL_URL` | Self-service registration flow URL. |
| `SIGNDROP_ACCOUNT_URL` | Provider user account settings URL. |
| `SIGNDROP_DOCDROP_URL` | Base URL of DocDrop for encrypted sharing (`https://docdrop.kaicorplabs.com`). |
| `SIGNDROP_TSA_URL` | Time Stamping Authority server URL (default: `https://freetsa.org/tsr`). |
| `KAICORP_FOOTER_LINKS` | Enable cross-service navigation in footer (`1` / `0`). |

---

## 📜 License

MIT License. Copyright (c) 2026 Ulzuhan.
