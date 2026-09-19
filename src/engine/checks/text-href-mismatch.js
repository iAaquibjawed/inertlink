/**
 * `text-href-mismatch` — the visible link text claims one destination, the href is another.
 *
 * This is the single most common phishing pattern in email and on compromised pages: the anchor
 * reads `https://www.paypal.com/verify` and points at `internal.invalid`. It is invisible without
 * a status bar, and status bars are exactly what modern apps suppress.
 *
 * Needs page context — `context.anchorText` — so it is the only check that is inert in a pure
 * URL-only call. That is fine: it returns no hit rather than a wrong one.
 *
 * The comparison is narrow on purpose. Text that merely *mentions* a brand ("Click here to reach
 * PayPal") is marketing, not deception. We only fire when the text is itself a URL or a bare
 * hostname — a concrete, checkable claim that turns out to be false.
 */

import { WEIGHTS } from '../scoring.js';
import { parseUrl, truncateHost } from '../parse.js';

/** Text that is a URL or a bare host — 'paypal.com', 'www.paypal.com/verify', 'https://…'. */
const URLISH = /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

export default {
  id: 'text-href-mismatch',

  /**
   * @param {import('../parse.js').ParsedUrl} parsed
   * @param {{ anchorText?: string }} context
   */
  run(parsed, context = {}) {
    const base = { id: 'text-href-mismatch', hit: false, weight: 0, reason: '' };

    const text = (context.anchorText ?? '').trim();
    if (!text || text.length > 120) return base;
    if (!URLISH.test(text)) return base;

    const claimed = parseUrl(text.includes('://') ? text : `https://${text}`);
    if (!claimed?.registrable || !parsed.registrable) return base;

    // Same organisation, different host, is not a lie: docs.example.com linking to example.com
    // is normal. We compare the registrable domain, which is the unit of ownership.
    if (claimed.registrable === parsed.registrable) return base;

    return {
      ...base,
      hit: true,
      weight: WEIGHTS['text-href-mismatch'],
      reason: `Text says ${truncateHost(claimed.registrable, 22)} but the link goes to ${truncateHost(
        parsed.host,
        22
      )}`,
    };
  },
};
