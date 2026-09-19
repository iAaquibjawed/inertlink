/**
 * User settings over chrome.storage.sync (CLAUDE.md §3).
 *
 * Phase 0: defaults + read/write only. Nothing consumes these yet.
 *
 * Privacy defaults are deliberate (golden rule 2): `onlineChecks` ships OFF. The extension is
 * fully useful offline, so the network is opt-in, not opt-out.
 */

export const SENSITIVITY = Object.freeze({
  STRICT: 'strict',
  BALANCED: 'balanced',
  RELAXED: 'relaxed',
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  sensitivity: SENSITIVITY.BALANCED,
  /** Online reputation lookups. Off until the user opts in. */
  onlineChecks: false,
  /** Provider id; only meaningful when onlineChecks is true. */
  provider: 'safebrowsing',
  /** User-supplied key, stored in sync so it follows the profile. Never sent to the page. */
  apiKey: '',
  /** Hosts the user trusts — short-circuits to `safe`, never hits the network. */
  allowlist: [],
  /** Hosts the user distrusts — forces `danger`. */
  blocklist: [],
  /** Hosts where the extension is paused, e.g. ['mail.google.com']. */
  pausedHosts: [],
  /**
   * Optional JSON feed of additional blocked hosts, refreshed weekly by the worker's alarm.
   * Empty by default, and ignored entirely unless `onlineChecks` is on — a product that promises
   * no network by default cannot ship a background job that phones home on a timer.
   */
  blocklistUrl: '',
});

/** Normalise user input into a host: strips scheme, path, port, whitespace, and a leading dot. */
export function normalizeHost(input) {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname;
  } catch {
    return raw.replace(/^\.+/, '').split('/')[0].split(':')[0];
  }
}

const hasStorage = () => typeof chrome !== 'undefined' && chrome?.storage?.sync;

/** @returns {Promise<typeof DEFAULT_SETTINGS>} */
export async function readSettings() {
  if (!hasStorage()) return { ...DEFAULT_SETTINGS };
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export async function writeSettings(patch) {
  if (!hasStorage()) return { ...DEFAULT_SETTINGS, ...patch };
  await chrome.storage.sync.set(patch);
  return readSettings();
}

/** Subscribe to cross-surface settings changes. Returns an unsubscribe fn. */
export function onSettingsChanged(handler) {
  if (!hasStorage()) return () => {};
  const listener = (changes, area) => {
    if (area !== 'sync') return;
    handler(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
