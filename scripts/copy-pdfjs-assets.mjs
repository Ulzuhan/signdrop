/**
 * Copies pdf.js's worker, character maps and standard fonts into public/.
 *
 * The worker is the code that parses the PDF. It used to be loaded from
 * cdnjs, and the character maps from jsDelivr — which meant that a product
 * whose whole argument is "the document never leaves your machine" handed the
 * parsing of that document to two third parties. Whoever controls that CDN
 * controls what runs against the contract you just opened. It is the one
 * contradiction in the repository that could not be argued away.
 *
 * They are copied rather than imported because pdf.js fetches the maps and
 * the fonts at run time, by URL, from wherever `cMapUrl` and
 * `standardFontDataUrl` point. Pointing them at our own origin is the whole
 * fix. The worker itself is resolved by the bundler (see src/lib/pdf/engine.ts)
 * and only copied here as the fallback for a build that did not bundle it.
 *
 * Run from `postinstall`, so a fresh clone has them before it ever builds,
 * and idempotent: the files are only written when they differ.
 *
 *   node scripts/copy-pdfjs-assets.mjs
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

if (!existsSync(from)) {
  console.log('[signdrop] pdfjs-dist is not installed yet; nothing to copy');
  process.exit(0);
}

mkdirSync(to, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts']) {
  const source = join(from, directory);
  if (!existsSync(source)) continue;
  cpSync(source, join(to, directory), { recursive: true });
}
const worker = join(from, 'build', 'pdf.worker.min.mjs');
if (existsSync(worker)) copyFileSync(worker, join(to, 'pdf.worker.min.mjs'));

const size = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size),
        0
      )
    : 0;
console.log(`[signdrop] pdf.js assets in public/pdfjs (${(size(to) / 1048576).toFixed(1)} MB): worker, cmaps, standard fonts`);
