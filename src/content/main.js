/**
 * Content script entrypoint. Bundled to `dist/content/content.js` as a classic IIFE.
 *
 * Why an entrypoint at all, when hover.js has `start()`: content scripts cannot be ES modules.
 * Neither a static `content_scripts` entry nor `chrome.scripting.registerContentScripts` supports
 * `import`, so the engine + badge + hover graph has to arrive as one classic script (ADR-0007).
 *
 * This file stays tiny on purpose. Everything it touches is in src/ as readable modules; the
 * bundler only concatenates, and the output is unminified so it can be diffed against the source.
 */

import { start } from './hover.js';

// Re-injection is normal: the worker re-registers on every grant and on browser restart, and a
// bfcache restore can run us twice. A second listener set would double every hover.
if (!window.__linkverifyActive) {
  window.__linkverifyActive = true;
  // One line, once per page. "Is it even running here?" is the first question every support
  // conversation starts with, and there is no other way for a user to answer it — the badge only
  // appears on hover, so silence is indistinguishable from a broken install.
  console.info('[linkverify] active on', location.host);
  start().catch(() => {
    // Fail safe, fail quiet (golden rule 6). A content script that cannot start must leave the
    // page exactly as it found it, with no error in the console the user did not cause.
  });
}
