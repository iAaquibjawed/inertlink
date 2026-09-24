/**
 * Safe URL parsing helpers. Pure — no DOM, no network (golden rule 5).
 *
 * "Safe" means: never throws, never resolves, and above all never *fetches*. We inspect the URL
 * string only — hovering a link must not touch the destination (golden rule 3).
 */

import TLDS from './data/tlds.json';
import SISTERS from './data/sister-domains.json';
import { unwrapUrl } from './unwrap.js';

const SISTER_MAP = new Map();
for (let i = 0; i < (SISTERS.clusters ?? []).length; i++) {
  const cluster = SISTERS.clusters[i];
  for (const domain of cluster) {
    let set = SISTER_MAP.get(domain);
    if (!set) {
      set = new Set();
      SISTER_MAP.set(domain, set);
    }
    set.add(i);
  }
}

/**
 * @typedef {Object} ParsedUrl
 * @property {string}   raw        Parsed target href.
 * @property {string}   [originalRaw] Raw input href before unwrapping.
 * @property {{ name: string, host: string }|null} [wrapper] Gateway info if unwrapped.
 * @property {string}   scheme     'https:', 'http:', 'javascript:', …
 * @property {string}   host       Lowercased hostname.
 * @property {string[]} labels     Host split on '.', e.g. ['secure','paypal','com'].
 * @property {string}   registrable Best-effort eTLD+1.
 * @property {string}   registrableLabel  The eTLD+1 minus its suffix — 'paypal' in 'paypal.co.uk'.
 * @property {string}   tld        Public suffix ('com', 'co.uk').
 * @property {string}   path
 * @property {string}   query
 * @property {string}   port       '' when default.
 * @property {string}   userinfo   Anything before '@' — the classic host-hiding trick.
 * @property {boolean}  isIpHost
 * @property {boolean}  hasPunycode
 * @property {string}   unicodeHost Host with punycode labels decoded where possible.
 */

/**
 * Schemes that execute or embed rather than navigate.
 *
 * `blob:` is deliberately NOT here. A blob URL is how ordinary sites hand you a file they just
 * generated — flagging every download button was a false positive with no threat behind it: the
 * page already had the bytes.
 */
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);

/**
 * `javascript:` hrefs that do nothing whatsoever.
 *
 * `javascript:void(0)` is the standard placeholder for a control that is driven by a click
 * handler — menus, tabs, "see more" toggles. Amazon's cart alone has fourteen, on Search, Cart,
 * Home, Orders, Update and a product promo. They execute nothing, navigate nowhere, and are not a
 * signal of anything at all.
 *
 * Treating these as dangerous was the single worst failure mode this project has (PLAN.md §6,
 * "crying wolf kills trust"): a red badge on every menu of a legitimate site trains the user to
 * ignore red, which is precisely how they end up clicking the one that mattered.
 */
const INERT_LINK_JS = /^javascript:\s*(?:void\s*\(\s*0\s*\)|void\s+0|;)?\s*;?\s*$/i;

/**
 * Is this an **InertLink** — an href that points at nothing at all?
 *
 * `javascript:void(0)`, `javascript:;`, and bare `#` fragments. Named because it is a distinct
 * answer the badge gives, not an absence of one: the anchor looks like a link, so we say plainly
 * that it goes nowhere rather than rendering a verdict about a destination that does not exist.
 *
 * @param {string} rawUrl
 */
export function isInertLinkHref(rawUrl) {
  const raw = String(rawUrl ?? '').trim();
  if (!raw || raw.startsWith('#')) return true;
  return INERT_LINK_JS.test(raw);
}

/** Schemes we understand well enough to reason about at all. */
const NAVIGABLE_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:']);

const PUBLIC_SUFFIXES = new Set(TLDS.publicSuffixes ?? []);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Decimal / octal / hex integer hosts — 'http://2130706433/' is 127.0.0.1 wearing a disguise. */
const INTEGER_HOST_RE = /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i;

export { DANGEROUS_SCHEMES, NAVIGABLE_SCHEMES };

/** Is this hostname an IP literal (v4, v6, or an integer/hex encoding of one)? */
function detectIpHost(host) {
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6 literal
  const m = IPV4_RE.exec(host);
  if (m) return m.slice(1).every((octet) => Number(octet) <= 255);
  // A bare integer or hex host is never a domain name — 'http://2130706433/' and 'http://0x7f.1/'
  // are 127.0.0.1 in disguise, and browsers navigate to them happily.
  return INTEGER_HOST_RE.test(host);
}

/**
 * Best-effort eTLD+1. We ship a curated multi-part suffix list rather than the full Public Suffix
 * List: the PSL is ~250kb and changes constantly, and the checks that consume this only need to
 * avoid the classic 'example.co.uk → co.uk' error. Unknown two-part hosts fall back to the last
 * two labels, which is right for the overwhelming majority of the single-label TLD space.
 */
function splitRegistrable(labels) {
  if (labels.length === 0) return { registrable: '', tld: '' };
  if (labels.length === 1) return { registrable: labels[0], tld: labels[0] };

  const lastTwo = labels.slice(-2).join('.');
  const lastThree = labels.slice(-3).join('.');

  if (labels.length >= 3 && PUBLIC_SUFFIXES.has(lastThree)) {
    return { registrable: labels.slice(-4).join('.'), tld: lastThree };
  }
  if (PUBLIC_SUFFIXES.has(lastTwo)) {
    return { registrable: labels.slice(-3).join('.'), tld: lastTwo };
  }
  return { registrable: lastTwo, tld: labels[labels.length - 1] };
}

/** Decode punycode labels for display. Never used for matching — only to show the user the truth. */
function toUnicodeHost(host) {
  if (!host.includes('xn--')) return host;
  try {
    // URL already stores the A-label form; the only portable decoder available to us in a pure
    // module is Intl's, which is not guaranteed. Falling back to the raw host is correct: showing
    // 'xn--pypal-4ve.com' is more honest than showing nothing.
    return host;
  } catch {
    return host;
  }
}

/**
 * Parse an href into the shape every check consumes.
 * Returns `null` for anything unparseable — callers treat that as `unknown`, never as safe.
 *
 * @param {string} rawUrl
 * @param {string} [base] Page URL, so relative hrefs resolve. Optional; string-only, no network.
 * @returns {ParsedUrl|null}
 */
export function parseUrl(rawUrl, base) {
  if (typeof rawUrl !== 'string') return null;
  const raw = rawUrl.trim();
  if (!raw) return null;

  // An InertLink has no destination to reason about. `null` here becomes `unknown`, never
  // `safe` — and the content script renders it as an explicit InertLink badge instead.
  if (isInertLinkHref(raw)) return null;

  // Unwrap email security wrappers (Outlook SafeLinks, Proofpoint, Google redirect, etc.)
  // so all checks evaluate the real destination rather than the gateway wrapper.
  const unwrapped = unwrapUrl(raw);
  const targetToParse = unwrapped.url;

  let url;
  try {
    url = base ? new URL(targetToParse, base) : new URL(targetToParse);
  } catch {
    return null;
  }

  const scheme = url.protocol.toLowerCase();

  // Script-bearing and inline-data schemes have no host to reason about, but they are the most
  // dangerous thing an <a href> can hold. Return a parsed shape so `non-https` can flag them
  // rather than dropping to `unknown`, which would render as a neutral badge.
  if (DANGEROUS_SCHEMES.has(scheme)) {
    return {
      raw: targetToParse,
      originalRaw: raw,
      wrapper: unwrapped.wrapper,
      scheme,
      host: '',
      labels: [],
      registrable: '',
      registrableLabel: '',
      tld: '',
      path: url.pathname ?? '',
      query: url.search ?? '',
      port: '',
      userinfo: '',
      isIpHost: false,
      hasPunycode: false,
      unicodeHost: '',
    };
  }

  // Anything else exotic (mailto:, tel:, chrome-extension:, custom app schemes) is out of scope.
  // We do not guess at its safety — `null` becomes `unknown`, and the badge says so.
  if (!NAVIGABLE_SCHEMES.has(scheme)) return null;

  const host = url.hostname.toLowerCase();
  if (!host) return null;

  const labels = host.split('.').filter(Boolean);
  const { registrable, tld } = splitRegistrable(labels);
  const registrableLabel = registrable.slice(0, registrable.length - tld.length).replace(/\.$/, '');

  // `url.username` is exactly the userinfo trick: in `http://apple.com@evil.ru/`, the browser
  // treats 'apple.com' as a username and 'evil.ru' as the host. The user reads it left to right
  // and sees their bank (golden rule: show the real host, PLAN.md §2).
  const userinfo = [url.username, url.password].filter(Boolean).join(':');

  return {
    raw: targetToParse,
    originalRaw: raw,
    wrapper: unwrapped.wrapper,
    scheme,
    host,
    labels,
    registrable,
    registrableLabel,
    tld,
    path: url.pathname ?? '',
    query: url.search ?? '',
    port: url.port ?? '',
    userinfo: userinfo ? decodeURIComponent(userinfo) : '',
    isIpHost: detectIpHost(host),
    hasPunycode: labels.some((l) => l.startsWith('xn--')),
    unicodeHost: toUnicodeHost(host),
  };
}

/**
 * Does `host` equal `domain`, or sit beneath it?
 * Substring matching is the bug this exists to prevent: 'evil-paypal.com'.includes('paypal.com')
 * is true, and treating that as a match would allowlist a phishing domain.
 *
 * @param {string} host
 * @param {string} domain
 */
export function hostMatches(host, domain) {
  if (!host || !domain) return false;
  const h = host.toLowerCase();
  const d = domain.toLowerCase().replace(/^\.+/, '');
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Middle-truncate a host for display: 'secure-login.paypal.com.evil.ru' → 'secure-lo…evil.ru'.
 * Truncating the *middle* is deliberate — the TLD is the tell, so the tail must survive.
 *
 * @param {string} host
 * @param {number} [max=32]
 */
export function truncateHost(host, max = 32) {
  if (!host || host.length <= max) return host ?? '';
  const keepEnd = Math.ceil((max - 1) / 2);
  const keepStart = max - 1 - keepEnd;
  return `${host.slice(0, keepStart)}…${host.slice(-keepEnd)}`;
}

/**
 * Levenshtein distance, capped. The cap turns an O(n·m) fill into an early exit — hover runs this
 * against every brand on every link, and a distance of 9 is as useless to us as a distance of 3.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [max=3] Return `max + 1` as soon as the distance is known to exceed it.
 */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Are these two registrable domains owned by the same organization?
 * Prevents false positives between rebrands (twitter.com <-> x.com),
 * cloud platforms (atlassian.com <-> atlassian.net), and sister properties
 * (outlook.com <-> office.com <-> microsoft.com).
 *
 * @param {string} a
 * @param {string} b
 */
export function areSisterDomains(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const setA = SISTER_MAP.get(a.toLowerCase());
  const setB = SISTER_MAP.get(b.toLowerCase());
  if (!setA || !setB) return false;
  for (const id of setA) {
    if (setB.has(id)) return true;
  }
  return false;
}

export { unwrapUrl };
