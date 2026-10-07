#!/usr/bin/env node
const { initializeRevocations } = require('./revocation-store.js');
if (process.argv.length !== 3 || process.argv[2] !== '--new') {
  console.error('Usage: SIGNDROP_REVOCATION_DB=/private/directory/revocations.sqlite node init-revocations.js --new');
  process.exit(1);
}
try {
  initializeRevocations();
  console.log('[signdrop] Initialized revocation protocol 1. Earlier account sessions are denied; guest signatures are unchanged.');
} catch {
  console.error('[signdrop] Cannot initialize revocations. Existing files are never reset.');
  process.exit(1);
}
