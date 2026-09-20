/**
 * Site build — entirely separate from the extension build.
 *
 * The extension's `build.mjs` asserts that nothing heavy reaches the content script. That guard
 * only works if the site's dependencies (GSAP, two variable fonts) can never wander into `dist/`,
 * so the site builds to its own output directory and is never referenced by the extension.
 *
 * Everything is bundled and self-hosted: no CDN font, no CDN script. That is ADR-0004's rule, and
 * it applies here for the same reason — a page whose pitch is "this thing doesn't phone home"
 * should not itself phone a third party to render its own headline.
 *
 *   npm run site        build once
 *   npm run site:dev    watch + serve on :5173
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { stripJsonComments, stripHtmlComments } from '../build-plugins.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'dist');
const PORT = Number(process.env.PORT ?? 5173);

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'styles'), { recursive: true });

const options = {
  entryPoints: [join(HERE, 'main.js'), join(HERE, 'mail.js')],
  outdir: OUT,
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox121', 'safari17'],
  loader: {
    '.json': 'json',
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
  },
  assetNames: 'assets/[name]-[hash]',
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
  plugins: [stripJsonComments],
  // main.js emits main.css from its font imports; the legal pages link that same file.
  entryNames: '[name]',
};

/** Files the HTML references directly, so they must land in dist/ alongside it. */
const STATIC_FILES = [
  'index.html',
  'privacy/index.html',
  'terms/index.html',
  'favicon-32.png',
  'mark-180.png',
  'mark-512.png',
  'mark-dark-512.png',
  'mark-dark-64.png',
  'og-card.jpg',
];

async function copyStatic() {
  for (const f of STATIC_FILES) {
    if (f.endsWith('.html')) {
      await mkdir(dirname(join(OUT, f)), { recursive: true });
      await writeFile(join(OUT, f), stripHtmlComments(await readFile(join(HERE, f), 'utf8')));
      continue;
    }
    await cp(join(HERE, f), join(OUT, f));
  }
  await cp(join(HERE, 'styles'), join(OUT, 'styles'), { recursive: true });
}

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

/** Same guard as the extension: nothing in the shipped output may reach for a third-party host. */
async function verifyNoRemoteRefs() {
  const suspects = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdn.',
    'unpkg.com',
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
  ];
  for (const file of (await walk(OUT)).filter((f) => /\.(html|css|js)$/.test(f))) {
    const text = await readFile(file, 'utf8');
    const hit = suspects.find((s) => text.includes(s));
    if (hit) throw new Error(`Remote resource "${hit}" found in ${file} — self-host it instead.`);
  }
}

await copyStatic();

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[site] watching');
} else {
  await esbuild.build(options);
  await verifyNoRemoteRefs();
  const bytes = (await readFile(join(OUT, 'main.js'))).length;
  console.log(`[site] bundle ${Math.round(bytes / 1024)}kb · no remote refs · → site/dist/`);
}

if (serve) {
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.svg': 'image/svg+xml',
  };
  createServer(async (req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safe = normalize(raw).replace(/^(\.\.[/\\])+/, '');
    const base = join(OUT, safe);
    if (!base.startsWith(OUT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // Static hosts resolve a directory path to its index.html. The dev server has to do the same
    // or /privacy/ works in production and 404s locally — which is the wrong way round for a
    // server whose only job is to tell you what production will look like.
    const candidates = extname(base)
      ? [base]
      : [join(base, 'index.html'), `${base}.html`];

    for (const file of candidates) {
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
        return;
      } catch {
        /* try the next candidate */
      }
    }
    res.writeHead(404).end('Not found');
  }).listen(PORT, () => console.log(`[site] http://localhost:${PORT}`));
}

// Keep the watcher alive when serving.
if (watch && !serve) await new Promise(() => {});
