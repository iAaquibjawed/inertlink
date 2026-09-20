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

/**
 * Accept only known settings keys, with the right type.
 *
 * `chrome.storage.sync.set` will happily write anything it is given, including keys nothing reads
 * and values of the wrong shape. Two concrete consequences: a caller could exhaust the sync quota
 * with junk keys and break settings for the whole profile, and a wrong-typed `allowlist` (a string
 * instead of an array) makes every `.some()` call in the engine throw — which the checks catch and
 * swallow, silently turning off a signal.
 *
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export function sanitizeSettings(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;

  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];

    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') clean[key] = value;
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value)) {
        clean[key] = value
          .filter((v) => typeof v === 'string' && v.length <= 253)
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 1000);
      }
    } else if (typeof fallback === 'string') {
      if (typeof value === 'string' && value.length <= 2048) clean[key] = value;
    }
  }

  // Sensitivity is an enum, not free text: an unknown value would silently fall back to balanced
  // thresholds while the UI showed something else.
  if (clean.sensitivity && !Object.values(SENSITIVITY).includes(clean.sensitivity)) {
    delete clean.sensitivity;
  }
  return clean;
}

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export async function writeSettings(patch) {
  const clean = sanitizeSettings(patch);
  if (!hasStorage()) return { ...DEFAULT_SETTINGS, ...clean };
  await chrome.storage.sync.set(clean);
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
