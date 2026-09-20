/**
 * Host-permission patterns, and the rules for turning them into content-script registrations.
 *
 * Pure (no `chrome.*`) so it is unit-testable: this filter silently decides whether the extension
 * runs at all, and a bug here is indistinguishable from the extension being broken.
 */

/**
 * The two patterns in `optional_host_permissions`. Requesting both means "run everywhere": one
 * prompt, permanent. Still opt-in and never requested at install (golden rule 4).
 */
export const ALL_SITES = Object.freeze(['http://*/*', 'https://*/*']);

/** Does this set of granted origins amount to "everywhere"? */
export function isAllSites(origins = []) {
  return ALL_SITES.every((p) => origins.includes(p));
}

/**
 * Granted origins → match patterns we can register a content script for.
 *
 * Drops anything that is not http(s): a file URL has an opaque origin, and chrome:// and
 * extension pages are off limits. Collapses to the broad "all sites" patterns when they are
 * present, because registering those alongside twenty specific hosts is the same script twice on
 * each — Chrome tolerates it, but the duplicate registration hides what is really registered.
 *
 * @param {string[]} origins
 * @returns {string[]}
 */
export function registerableOrigins(origins = []) {
  const usable = origins.filter((o) => /^https?:\/\//.test(o));
  if (usable.length === 0) return [];

  const broad = ALL_SITES.filter((p) => usable.includes(p));
  if (broad.length === 0) return usable;

  // Keep any http(s) pattern the broad ones do not already cover. In practice that is none, but
  // deriving it beats assuming it.
  const covered = (pattern) => broad.some((b) => b.split(':')[0] === pattern.split(':')[0]);
  return [...broad, ...usable.filter((p) => !broad.includes(p) && !covered(p))];
}

/** `https://www.amazon.com/dp/x` → `https://www.amazon.com/*`, or null if it cannot be a pattern. */
export function originPattern(url) {
  try {
    const { origin } = new URL(url);
    // Opaque origins (file://, sandboxed frames) stringify to "null" and are not match patterns.
    return origin && origin !== 'null' ? `${origin}/*` : null;
  } catch {
    return null;
  }
}
