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
import { parseUrl, truncateHost, areSisterDomains } from '../parse.js';
import SHORTENERS from '../data/shorteners.json';

/** Text that is a URL or a bare host — 'paypal.com', 'www.paypal.com/verify', 'https://…'. */
const URLISH = /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

const ALL_SHORTENERS = new Set([
  ...(SHORTENERS.hosts ?? []),
  ...Object.keys(SHORTENERS.branded ?? {}),
]);

/** Known email marketing & click-tracking platforms that rewrite link destinations. */
const EMAIL_TRACKERS = new Set([
  'sendgrid.net',
  'mailchimp.com',
  'mandrillapp.com',
  'hubspotlinks.com',
  'substack.com',
  'convertkit.com',
  'beehiiv.com',
]);

export default {
  id: 'text-href-mismatch',

  /**
   * @param {import('../parse.js').ParsedUrl} parsed
   * @param {{ anchorText?: string }} context
   */
  run(parsed, context = {}) {
    const base = { id: 'text-href-mismatch', hit: false, weight: 0, reason: '' };

    const rawText = (context.anchorText ?? '').trim();
    if (!rawText || rawText.length > 120) return base;

    // Clean leading/trailing parentheses, quotes, and punctuation (e.g. "(example.com)" or "example.com.")
    const text = rawText.replace(/^[(\s"']+|[)\s.,;:!?'"\]]+$/g, '');
    if (!URLISH.test(text)) return base;

    const claimed = parseUrl(text.includes('://') ? text : `https://${text}`);
    if (!claimed?.registrable || !parsed.registrable) return base;

    // Same organisation, different host, is not a lie: docs.example.com linking to example.com is normal.
    if (claimed.registrable === parsed.registrable) return base;

    // Canonical sister domain or rebrand (e.g. twitter.com -> x.com, atlassian.com -> atlassian.net)
    if (areSisterDomains(claimed.registrable, parsed.registrable)) return base;

    // If anchor text was a shortener (e.g. bit.ly/xyz) and href is the full target, it is an expanded link
    if (ALL_SHORTENERS.has(claimed.registrable)) return base;

    // If target is a known email delivery tracker, it's a tracking redirect rather than a phishing imposter
    const isTracker = EMAIL_TRACKERS.has(parsed.registrable);

    return {
      ...base,
      hit: true,
      weight: isTracker ? WEIGHTS['text-href-mismatch'] * 0.4 : WEIGHTS['text-href-mismatch'],
      reason: isTracker
        ? `Email click tracker: text says ${truncateHost(claimed.registrable, 20)} but routes through ${truncateHost(parsed.host, 20)}`
        : `Text says ${truncateHost(claimed.registrable, 22)} but the link goes to ${truncateHost(parsed.host, 22)}`,
    };
  },
};
