/**
 * Tiny static server for the manual smoke page.
 *
 * Exists because the smoke page cannot be tested over a file URL. The extension declares only http
 * and https patterns under `optional_host_permissions` (ADR-0003), and a file URL has an opaque
 * origin that cannot be expressed as a match pattern at all — so the popup's "Turn on for this
 * site" has nothing to request. Serving over http makes the page an ordinary origin the user can
 * grant like any other.
 *
 * Node's http module only. No dependency for a dev-only script.
 *
 *   npm run smoke   →   http://localhost:8787/phishing-sandbox.html
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const path = requested === '/' ? '/phishing-sandbox.html' : requested;

  // Serve only from this directory. A dev server is still a server.
  const resolved = join(DIR, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`[inertlink] smoke page → http://localhost:${PORT}/phishing-sandbox.html`);
  console.log('           open it, then click the InertLink icon → "Turn on for this site"');
});
