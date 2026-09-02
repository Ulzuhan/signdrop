#!/usr/bin/env node
/**
 * Production entry point for SignDrop.
 */
const path = require('node:path');
const fs = require('node:fs');

/**
 * No secret, no service.
 *
 * The session cookie is sealed with SIGNDROP_SESSION_SECRET. Starting without
 * one and falling back to something built in, or to a value generated at boot,
 * are both worse than refusing: the first is a signing key published on
 * GitHub, and the second logs everybody out on every restart while looking
 * like it works. So production stops here, loudly, before anything listens.
 *
 * Development is allowed through without one — there is nothing to protect on
 * a laptop — but sessions will not work, which is exactly what the message
 * says.
 */
const secret = (process.env.SIGNDROP_SESSION_SECRET || '').trim();
if (Buffer.byteLength(secret, 'utf8') < 32) {
  const message =
    "[signdrop] SIGNDROP_SESSION_SECRET is missing or shorter than 32 bytes. Generate one with 'openssl rand -hex 32'.";
  if (process.env.NODE_ENV === 'production') {
    console.error(`${message} Refusing to start.`);
    process.exit(1);
  }
  console.warn(`${message} Sessions are disabled.`);
}

// Set default port if not provided
process.env.PORT = process.env.SIGNDROP_PORT || process.env.PORT || '3466';
process.env.HOSTNAME = process.env.SIGNDROP_HOST || process.env.HOSTNAME || '0.0.0.0';

const candidates = [
  path.join(__dirname, 'server.js'),
  path.join(__dirname, '..', 'server.js'),
  path.join(__dirname, '..', '.next', 'standalone', 'server.js'),
];

const target = candidates.find((candidate) => fs.existsSync(candidate));
if (!target) {
  console.error("[signdrop] Cannot find Next server. Run 'npm run build' before starting.");
  process.exit(1);
}

console.log(`[signdrop] Starting SignDrop server on ${process.env.HOSTNAME}:${process.env.PORT}...`);
require(target);
