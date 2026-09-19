/**
 * `encoded-obfuscation` — the URL is doing work to be unreadable.
 *
 * Four related tells, all cheap to compute from the string:
 *   • heavy percent-encoding, especially of characters that never need it
 *   • a very long random-looking host label (DGA output, or a one-time subdomain per victim)
 *   • an embedded second URL in the query — the open-redirect shape, `?url=https://evil.ru`
 *   • base64-looking blobs in the path, which is how credential-harvest kits carry the target
 *     email so the fake login page can pre-fill it
 *
 * None of these is proof. Together with anything else they are damning, which is what the scoring
 * model is for.
 */

import { WEIGHTS } from '../scoring.js';

/** %XX sequences. A handful is normal; a wall of them is someone hiding a string. */
const ENCODED = /%[0-9a-f]{2}/gi;
/** A nested absolute URL in the query — open-redirect / cloaking. */
const NESTED_URL = /[?&][^=]*=(https?%3a%2f%2f|https?:\/\/)/i;
/** Long unbroken base64-ish run in the path. */
const BASE64ISH = /\/[A-Za-z0-9+/=_-]{28,}(\/|$)/;

/** Shannon entropy per character. Random strings sit high; English words sit low. */
function entropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export default {
  id: 'encoded-obfuscation',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'encoded-obfuscation', hit: false, weight: 0, reason: '' };

    const reasons = [];
    let factor = 0;

    const encodedCount = (parsed.raw.match(ENCODED) ?? []).length;
    if (encodedCount >= 6) {
      factor += 1;
      reasons.push('the address is heavily encoded to hide what it says');
    }

    if (NESTED_URL.test(parsed.query)) {
      factor += 1.5;
      reasons.push('it carries a second web address that it will forward you to');
    }

    if (BASE64ISH.test(parsed.path)) {
      factor += 0.75;
      reasons.push('the path contains an encoded blob rather than readable words');
    }

    // Longest host label, ignoring the public suffix. `a8f3k92lqz0xw1.example.com` is a
    // machine-generated name; `documentation.example.com` is not, and both are long.
    const longest = parsed.labels
      .slice(0, Math.max(parsed.labels.length - 1, 1))
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    if (longest.length >= 16 && entropy(longest) > 3.6 && !longest.includes('-')) {
      factor += 1;
      reasons.push('the address contains a long random-looking name');
    }

    if (factor === 0) return base;

    return {
      ...base,
      hit: true,
      weight: Math.min(WEIGHTS['encoded-obfuscation'] * factor, WEIGHTS['encoded-obfuscation'] * 2),
      // One reason, the strongest, goes in the badge. The rest live in the details panel.
      reason: `Hidden content — ${reasons[0]}`,
    };
  },
};
