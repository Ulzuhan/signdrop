#!/usr/bin/env node
/**
 * Production entry point for SignDrop.
 */
const path = require('node:path');
const fs = require('node:fs');

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
