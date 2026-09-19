/**
 * Verdict cache over chrome.storage.local, keyed by host.
 *
 * This is a privacy feature before it is a performance one: a cache hit is a network call the
 * user's browsing never generated (golden rule 2). Check it before every provider call.
 *
 * Only the **host** is ever a key. No paths, no query strings, no timestamps of individual visits
 * — the cache must not become a browsing history in disguise.
 */

const PREFIX = 'lv:verdict:';

/** TTL by verdict. Safe answers age well; dangerous ones must be allowed to expire quickly. */
export const TTL_MS = Object.freeze({
  safe: 7 * 24 * 60 * 60 * 1000,
  caution: 24 * 60 * 60 * 1000,
  danger: 6 * 60 * 60 * 1000,
  unknown: 60 * 60 * 1000,
});

/** Cap so a long session can't grow storage without bound. Oldest-expiring entries go first. */
const MAX_ENTRIES = 2000;

const key = (host) => `${PREFIX}${host}`;
const hasStorage = () => typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local);

/**
 * @param {string} host
 * @returns {Promise<{verdict: string, source: string, reasons: string[], expiresAt: number}|null>}
 */
export async function readCached(host) {
  if (!hasStorage() || !host) return null;
  try {
    const k = key(host);
    const stored = (await chrome.storage.local.get(k))[k];
    if (!stored) return null;

    if (stored.expiresAt <= Date.now()) {
      // Expired entries are removed on read rather than swept on a timer: the worker sleeps, and
      // a cache entry that outlives its TTL is a stale verdict we would otherwise serve.
      await chrome.storage.local.remove(k);
      return null;
    }
    return stored;
  } catch {
    return null; // Fail safe, fail quiet — a cache miss is always a survivable answer.
  }
}

/**
 * @param {string} host
 * @param {{ verdict: string, source: string, reasons?: string[], ttl?: number }} entry
 */
export async function writeCached(host, { verdict, source, reasons = [], ttl }) {
  if (!hasStorage() || !host || !verdict) return;
  try {
    const lifetime = ttl ?? TTL_MS[verdict] ?? TTL_MS.unknown;
    await chrome.storage.local.set({
      [key(host)]: { verdict, source, reasons, expiresAt: Date.now() + lifetime },
    });
    await evictIfFull();
  } catch {
    /* A failed cache write costs a future network call, nothing more. */
  }
}

async function evictIfFull() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => k.startsWith(PREFIX));
  if (entries.length <= MAX_ENTRIES) return;

  entries.sort((a, b) => (a[1]?.expiresAt ?? 0) - (b[1]?.expiresAt ?? 0));
  const drop = entries.slice(0, entries.length - MAX_ENTRIES).map(([k]) => k);
  await chrome.storage.local.remove(drop);
}

/** Drop every cached verdict. Exposed to the user in options — "forget what you know about me". */
export async function clearCache() {
  if (!hasStorage()) return 0;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

/** How many verdicts are held. Shown in options so "clear cache" is not a blind button. */
export async function cacheSize() {
  if (!hasStorage()) return 0;
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(PREFIX)).length;
}

export { key as cacheKey };
