/**
 * InertLink build.
 *
 * Four outputs, three shapes (ADR-0001, ADR-0007):
 *
 *   popup / options  → esbuild, ESM, minified. React + Framer Motion (ADR-0001).
 *   content          → esbuild, **IIFE, not minified**. Content scripts cannot be ES modules, so
 *                      the engine + badge + hover graph must arrive as one classic script. It is
 *                      left unminified because this is the code that runs on other people's
 *                      pages: a reviewer must be able to diff dist/content/content.js against
 *                      src/ by eye.
 *   worker           → esbuild, ESM. Bundled rather than copied so it can `import` the engine and
 *                      its JSON data without relying on import attributes.
 *   shared/, assets/ → copied verbatim.
 *
 * Golden rule 1 (no remote code): esbuild inlines every dependency at build time. Nothing in
 * dist/ ever fetches script or style from the network, and `verifyNoRemoteRefs()` fails the build
 * if a CDN URL reappears in a page or a bundle.
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripJsonComments } from './build-plugins.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  target: ['chrome120'],
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.json': 'json' },
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  plugins: [stripJsonComments],
};

/** @type {Array<{ entry: string, out: string, options: object }>} */
const BUNDLES = [
  {
    entry: join(SRC, 'popup/main.jsx'),
    out: join(DIST, 'popup/popup.js'),
    options: { format: 'esm', minify: !watch },
  },
  {
    entry: join(SRC, 'options/main.jsx'),
    out: join(DIST, 'options/options.js'),
    options: { format: 'esm', minify: !watch },
  },
  {
    entry: join(SRC, 'content/main.js'),
    out: join(DIST, 'content/content.js'),
    // Classic script, readable output — see the header comment.
    options: { format: 'iife', minify: false },
  },
  {
    entry: join(SRC, 'worker/service-worker.js'),
    out: join(DIST, 'worker/service-worker.js'),
    options: { format: 'esm', minify: false },
  },
];

/** Copied verbatim, relative to src/. `shared/` holds tokens.css, which the pages <link> to. */
const COPY_DIRS = ['shared'];

/** Static files copied alongside each bundle. */
const COPY_FILES = [
  ['popup/popup.html', 'popup/popup.html'],
  ['popup/popup.css', 'popup/popup.css'],
  ['options/options.html', 'options/options.html'],
  ['options/options.css', 'options/options.css'],
];

async function copyStatic() {
  await Promise.all(COPY_DIRS.map((d) => cp(join(SRC, d), join(DIST, d), { recursive: true })));
  for (const [from, to] of COPY_FILES) {
    await mkdir(dirname(join(DIST, to)), { recursive: true });
    await cp(join(SRC, from), join(DIST, to));
  }
  await cp(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
  // The manifest lives in src/, NOT the repo root. A root manifest.json is loadable by
  // "Load unpacked" — Chrome accepts it, then every path inside it 404s, and the result is an
  // extension that installs cleanly and does absolutely nothing. Keeping it out of the root makes
  // that mistake impossible: picking the repo folder now fails loudly with "Manifest file is
  // missing or unreadable".
  await cp(join(SRC, 'manifest.json'), join(DIST, 'manifest.json'));
}

/** Walk dist/ and return every file path. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/**
 * Cheap guard for golden rule 1. Catches a stray CDN <link>/<script> or a runtime remote fetch
 * before it ships — in the HTML *and* in the bundles, since a dependency can drag one in.
 */
async function verifyNoRemoteRefs() {
  const suspects = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdn.',
    'unpkg.com',
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
  ];
  const files = (await walk(DIST)).filter((f) => /\.(html|css|js)$/.test(f));

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const hit = suspects.find((s) => text.includes(s));
    if (hit) {
      throw new Error(`Remote resource "${hit}" found in ${file} — violates golden rule 1.`);
    }
  }
}

/**
 * The content script is the only code that runs on a user's pages. If React or Framer Motion ever
 * reaches it, ADR-0002 has been broken silently and the performance cost lands on every site the
 * user visits. Assert it at build time rather than trusting review.
 */
async function verifyContentIsLean() {
  const file = join(DIST, 'content/content.js');
  const text = await readFile(file, 'utf8');
  for (const banned of ['react/jsx-runtime', 'framer-motion', 'react-dom']) {
    if (text.includes(banned)) {
      throw new Error(`"${banned}" reached the content script — violates ADR-0002.`);
    }
  }
  const kb = Math.round(text.length / 1024);
  if (kb > 80) throw new Error(`content.js is ${kb}kb — over the 80kb budget (ADR-0002).`);
  console.log(`[inertlink] content script: ${kb}kb, dependency-free`);
}

/**
 * Every path the manifest names must exist in dist/.
 *
 * Chrome does not check this at install time: a manifest whose `service_worker`, popup, and icons
 * all 404 still loads "successfully", and the extension then does nothing with no visible error.
 * That failure is indistinguishable from a bug in our own code, so we refuse to ship it.
 */
async function verifyManifestResolves() {
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
  const refs = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    // Not named in the manifest, but registered at runtime by the worker (ADR-0003) — so a
    // missing content script fails exactly as silently.
    'content/content.js',
  ].filter(Boolean);

  const missing = [];
  for (const ref of new Set(refs)) {
    try {
      await readFile(join(DIST, ref));
    } catch {
      missing.push(ref);
    }
  }
  if (missing.length) {
    throw new Error(`manifest references files missing from dist/: ${missing.join(', ')}`);
  }
  console.log(`[inertlink] manifest: ${new Set(refs).size} referenced files all present`);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await copyStatic();

if (watch) {
  for (const { entry, out, options } of BUNDLES) {
    const ctx = await esbuild.context({ ...common, ...options, entryPoints: [entry], outfile: out });
    await ctx.watch();
  }
  console.log('[inertlink] watching — reload the extension after each rebuild');
} else {
  await Promise.all(
    BUNDLES.map(({ entry, out, options }) =>
      esbuild.build({ ...common, ...options, entryPoints: [entry], outfile: out })
    )
  );
  await verifyNoRemoteRefs();
  await verifyContentIsLean();
  await verifyManifestResolves();
  await writeFile(
    join(DIST, '.buildinfo'),
    'built from src/ — load dist/ as the unpacked extension\n'
  );
  console.log('[inertlink] build complete → dist/');
}
