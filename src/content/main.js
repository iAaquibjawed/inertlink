/**
 * Content script entrypoint, bundled to `dist/content/content.js` as a classic IIFE.
 *
 * Content scripts cannot be ES modules — neither a static `content_scripts` entry nor
 * `chrome.scripting.registerContentScripts` supports `import` — so the whole graph must arrive as
 * one classic script (ADR-0007). Output is left unminified so it can be diffed against src/.
 */

import { start } from './hover.js';

// Re-injection is normal: the worker re-registers on every grant and on browser restart, and a
// bfcache restore can run us twice. A second listener set would double every hover.
if (!window.__inertlinkActive) {
  window.__inertlinkActive = true;
  // The badge only appears on hover, so without this there is no way to tell "running" from
  // "broken install".
  console.info('[inertlink] active on', location.host);
  // Fail quiet (golden rule 6): a content script that cannot start leaves the page as it found it.
  start().catch(() => {});
}
