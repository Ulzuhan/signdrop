#!/usr/bin/env node
/**
 * Completes the standalone output after the build for SignDrop.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standalone)) {
  console.error("[signdrop] No standalone output found; check 'output: standalone' in next.config.ts");
  process.exit(1);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
}

copyDir(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'));
copyDir(path.join(root, 'public'), path.join(standalone, 'public'));
fs.copyFileSync(path.join(__dirname, 'start.js'), path.join(standalone, 'start.js'));

console.log('[signdrop] Standalone build prepared successfully (static assets + launcher).');
