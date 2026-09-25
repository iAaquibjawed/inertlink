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
import { parseUrl, areSisterDomains } from '../parse.js';

/** %XX sequences. A handful is normal; a wall of them is someone hiding a string. */
const ENCODED = /%[0-9a-f]{2}/gi;
/** Hex-encoded alphanumeric characters (%41-%5A, %61-%7A, %30-%39) — only used to evade scanners. */
// No `g` flag: this is only ever `.test()`ed, and a global regex's `.test()` carries `lastIndex`
// between calls — the same URL could score differently depending on what was hovered before it.
const OBFUSCATED_ALPHANUMERIC = /%(?:4[1-9a-f]|5[0-9a]|6[1-9a-f]|7[0-9a]|3[0-9])/i;
/**
 * A percent-encoded UTF-8 character: lead byte %C2–%F4, then continuation bytes %80–%BF. This is
 * how every Chinese, Arabic, Hebrew, or Cyrillic URL is written, so it is language, not hiding.
 */
const UTF8_CHAR = /%(?:c[2-9a-f]|d[0-9a-f]|e[0-9a-f]|f[0-4])(?:%[89ab][0-9a-f]){1,3}/gi;
/** A nested absolute URL in the query — open-redirect / cloaking. */
const NESTED_URL = /[?&][^=]*=(https?%3a%2f%2f|https?:\/\/)([^&]+)/i;

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

/** Check if a path segment is an actual obfuscated base64 blob rather than a UUID or Git commit. */
function isSuspiciousBase64Blob(segment) {
  if (!segment || segment.length < 28) return false;
  // Only the base64 alphabet. A '%' or '.' means an encoded filename ('Coexisting%20with.pdf').
  if (!/^[A-Za-z0-9+/=_-]+$/.test(segment)) return false;
  // Words joined by underscores ('rel2a_COB_detailed_Scotland') are a slug, not a payload.
  if (segment.split('_').filter((w) => /^[A-Za-z]{3,}$/.test(w)).length >= 2) return false;
  // Git commits (40/64 hex chars), UUIDs with hyphens, and simple alphanumeric slugs are not base64 payloads
  if (/^[0-9a-fA-F-]+$/.test(segment)) return false;
  if (/[+/=]/.test(segment)) return true;
  const hasUpper = /[A-Z]/.test(segment);
  const hasLower = /[a-z]/.test(segment);
  const hasDigit = /[0-9]/.test(segment);
  return hasUpper && hasLower && hasDigit && !segment.includes('-') && entropy(segment) > 3.8;
}

/**
 * Could a person say this? Random labels have few vowels and long consonant runs;
 * 'cloudflareinsights' and 'medicalnewstoday' are long and high-entropy but pronounceable.
 */
function isPronounceable(label) {
  const letters = label.replace(/[^a-z]/g, '');
  if (letters.length < label.length * 0.8) return false; // digit-heavy is not a word
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  const longestRun = Math.max(0, ...(letters.match(/[^aeiouy]+/g) ?? []).map((r) => r.length));
  return vowels / letters.length >= 0.3 && longestRun <= 4;
}

/** Extract destination parsed URL from a nested URL parameter. */
function extractNestedParsed(query) {
  const m = NESTED_URL.exec(query);
  if (!m) return null;
  try {
    let dest = m[1] + m[2];
    if (dest.includes('%')) {
      try {
        dest = decodeURIComponent(dest);
      } catch {}
    }
    return parseUrl(dest);
  } catch {
    return null;
  }
}

export default {
  id: 'encoded-obfuscation',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'encoded-obfuscation', hit: false, weight: 0, reason: '' };

    const reasons = [];
    let factor = 0;

    // Alphanumeric hex encoding is an intentional evasion technique; generic %XX needs a high threshold
    const hasAlphaHex = OBFUSCATED_ALPHANUMERIC.test(parsed.raw);
    const utf8Escapes = ((parsed.raw.match(UTF8_CHAR) ?? []).join('').match(/%/g) ?? []).length;
    const encodedCount = (parsed.raw.match(ENCODED) ?? []).length - utf8Escapes;
    if (hasAlphaHex) {
      factor += 1;
      reasons.push('it uses hex-encoded letters to hide text from scanners');
    } else if (encodedCount >= 16) {
      factor += 1;
      reasons.push('the address is heavily encoded to hide what it says');
    }

    // Only penalize nested URLs when they point off-domain (open redirect). In-domain and sister-domain returns are normal.
    if (NESTED_URL.test(parsed.query)) {
      const nested = extractNestedParsed(parsed.query);
      const isTrustedDestination =
        nested?.registrable &&
        parsed.registrable &&
        (nested.registrable === parsed.registrable ||
          areSisterDomains(nested.registrable, parsed.registrable));

      if (!isTrustedDestination) {
        factor += 1.5;
        reasons.push('it carries a second web address that it will forward you to');
      }
    }

    // Check path segments for true base64 blobs, ignoring commit hashes and UUIDs
    const pathSegments = parsed.path.split('/').filter(Boolean);
    if (pathSegments.some(isSuspiciousBase64Blob)) {
      factor += 0.75;
      reasons.push('the path contains an encoded blob rather than readable words');
    }

    // Longest host label, ignoring the public suffix. `a8f3k92lqz0xw1.example.com` is a
    // machine-generated name; `documentation.example.com` is not, and both are long.
    const longest = parsed.labels
      .slice(0, Math.max(parsed.labels.length - 1, 1))
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    if (longest.length >= 16 && entropy(longest) > 3.6 && !longest.includes('-') && !isPronounceable(longest)) {
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
