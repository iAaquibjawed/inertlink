/**
 * `excessive-subdomains` — the hostname has an unusual number of dots.
 *
 * Deep hosts are how you pack a convincing story into the part of the URL nobody audits:
 * `secure.login.account-verify.update.example.com.evil.tk`. Real sites are shallow —
 * `mail.google.com` is two levels and that is already deeper than most.
 *
 * Known hosting suffixes (`*.github.io`, `*.s3.amazonaws.com`) are handled by parse.js's public
 * suffix list, so `user.github.io` counts as zero subdomains rather than two. Without that this
 * check would fire on every project page on the internet.
 */

import { WEIGHTS } from '../scoring.js';

/** Two subdomains is ordinary (`static.eu.example.com`). Three starts to be a story. */
const THRESHOLD = 3;

export default {
  id: 'excessive-subdomains',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'excessive-subdomains', hit: false, weight: 0, reason: '' };
    if (!parsed.registrable || parsed.isIpHost) return base;

    const registrableLabels = parsed.registrable.split('.').length;
    const depth = parsed.labels.length - registrableLabels;
    if (depth < THRESHOLD) return base;

    // Each level past the threshold adds evidence, but the signal saturates — a 12-level host is
    // not four times worse than a 6-level one, it is the same trick with more padding.
    const over = Math.min(depth - THRESHOLD + 1, 3);
    return {
      ...base,
      hit: true,
      weight: (WEIGHTS['excessive-subdomains'] * over) / 2,
      reason: `${depth} levels of subdomain — the words before the real address mean nothing`,
    };
  },
};
