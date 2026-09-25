#!/usr/bin/env node
/**
 * `node scripts/model/run.mjs <train|eval|why|popular> [args]` — bundles the script with esbuild first.
 *
 * The engine imports its data as `import X from './x.json'`, which esbuild and vitest accept and
 * plain Node refuses without import attributes. Bundling is how the trainer gets to import the
 * engine's *real* feature code instead of a copy that could drift from it.
 */

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const [, , which, ...rest] = process.argv;
if (!['train', 'eval', 'why', 'popular'].includes(which)) {
  console.error('usage: run.mjs <train|eval|why|popular> [args]');
  process.exit(1);
}

fs.mkdirSync('.model-data', { recursive: true });
const outfile = `.model-data/${which}.bundle.mjs`;
await build({
  entryPoints: [`scripts/model/${which}.mjs`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'warning',
});
process.argv = [process.argv[0], outfile, ...rest];
await import(pathToFileURL(outfile).href);
