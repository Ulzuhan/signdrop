# SignDrop

**Client-side PDF signing, cryptographic sealing, and document verification.** Zero-knowledge, browser-processed, and tamper-evident.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Uploading confidential contracts, agreements, or NDA documents to third-party electronic signature SaaS platforms exposes sensitive terms to external data processing. **SignDrop** enables users to stamp visual signatures, initials, dates, and form fields into PDF documents, generating an integrity seal with SHA-256 checksums and an audit certificate — entirely inside the user's browser.

---

## 🔒 Privacy & Cryptographic Model

- **100% Client-side PDF Processing**: The original PDF document is parsed, modified, and rendered locally in the browser using `pdf-lib` and WebAssembly. **The document never uploads to the server during signing**.
- **Integrity Seal & Audit Trail**:
  - Calculates a SHA-256 cryptographic digest of the original and signed documents.
  - Generates an optional tamper-evident signature certificate / audit sheet appended to the PDF.
- **Verification Engine**: Allows any party to drop a signed PDF to verify that the visual stamps match the embedded cryptographic hash and haven't been altered.
- **Zero Cloud Storage by Default**: Once signed, the user downloads the resulting file directly to their machine. Optional integration with **DocDrop** for end-to-end encrypted dispatch to external signers/recipients.

---

## ⚡ Core Features

- **Multi-Type Signatures**:
  - Draw signature (smooth vector canvas).
  - Type signature (curated professional typography).
  - Upload signature image (with automatic background removal).
- **Document Annotations**: Place text fields, dates, checkboxes, and initials across any page.
- **Multi-page Support**: Fast navigation, zoom, and placement tools.
- **Audit Sheet Generation**: Appends a clean summary page detailing signer identifier/email, timestamp, document hash, and signature metadata.
- **PDF Verification Tool**: Fast drag-and-drop verification screen to validate document integrity and signature hashes.

---

## 👥 Access & Permissions Model

- **Free / Public In-Browser Signing**: Direct signing and verification without mandatory account creation.
- **Authenticated Features (OIDC)**: Saving signature templates, keeping reusable document templates, and sending signature request links via encrypted DocDrop drops.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Single Page Application (React / Vite or Next.js static) utilizing `pdf-lib` and `pdfjs-dist` in Web Workers.
- **UI Components**: Built using the KaiCorp theme (*Space Grotesk*, *Inter*, *JetBrains Mono*).
- **Backend (Optional API)**: Lightweight Node.js or Go micro-service for template storage and OIDC session handling.
- **Container / Isolation**: `read_only: true`, `cap_drop: [ALL]`, non-root user (`uid 10001`), loopback port binding (`127.0.0.1:3466`).

---

## ⚙️ Environment Variables

| Variable | Description |
|---|---|
| `SIGNDROP_PORT` | Port to listen on (default: `3466`). |
| `SIGNDROP_SESSION_SECRET` | Secret key for signing session cookies. |
| `SIGNDROP_OIDC_CLIENT_ID` | OIDC Client ID. |
| `SIGNDROP_OIDC_CLIENT_SECRET` | OIDC Client Secret. |
| `SIGNDROP_OIDC_DISCOVERY_URL` | OIDC Issuer / Discovery URL (`/.well-known/openid-configuration`). |
| `SIGNDROP_OIDC_REDIRECT_URI` | Public callback URL (e.g. `https://sign.kaicorplabs.com/auth/callback`). |
| `SIGNDROP_ENROLL_URL` | Self-service registration flow URL. |
| `SIGNDROP_ACCOUNT_URL` | Provider user account settings URL. |
| `SIGNDROP_DOCDROP_URL` | Base URL of DocDrop for encrypted sharing integration (`https://docdrop.kaicorplabs.com`). |
| `SIGNDROP_PUBLIC_HOST` | Explicit public hostname for origin guarding (`sign.kaicorplabs.com`). |
