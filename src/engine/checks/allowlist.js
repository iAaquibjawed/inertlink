/**
 * `allowlist` — the registrable domain is known-safe, or the user trusts it.
 *
 * A hit contributes a large negative weight, which drives the score below every threshold and
 * produces `safe`. It also sets the `suppressNetwork` flag that scoring.js reads: an allowlisted
 * host must never be sent to a reputation provider, because the whole point of trusting it is that
 * we already have our answer (golden rule 2).
 *
 * The comparison is on the **registrable domain**, exact. `google.com.evil.ru` has registrable
 * domain `evil.ru` and matches nothing here. A naive `host.includes('google.com')` would allowlist
 * that attack, which is why parse.js computes eTLD+1 in the first place.
 *
 * `local-blocklist` is checked at a higher magnitude and wins ties. See that file for why.
 */

import { WEIGHTS } from '../scoring.js';
import { hostMatches } from '../parse.js';
import KNOWN_SAFE from '../data/known-safe.json';

const BUNDLED = new Set(KNOWN_SAFE.domains ?? []);

export default {
  id: 'allowlist',

  /**
   * @param {import('../parse.js').ParsedUrl} parsed
   * @param {{ userAllowlist?: string[] }} context
   */
  run(parsed, context = {}) {
    const base = { id: 'allowlist', hit: false, weight: 0, reason: '' };
    if (!parsed.host || parsed.isIpHost) return base;

    // Only ever safe over TLS. An allowlisted domain reached over http:// is still a downgrade,
    // and silencing that would hide a real attack on a real bank.
    if (parsed.scheme !== 'https:') return base;

    const user = context.userAllowlist ?? [];
    if (user.some((h) => hostMatches(parsed.host, h))) {
      return {
        ...base,
        hit: true,
        weight: WEIGHTS.allowlist,
        reason: 'You marked this site as trusted',
      };
    }

    if (BUNDLED.has(parsed.registrable)) {
      return {
        ...base,
        hit: true,
        weight: WEIGHTS.allowlist,
        reason: `${parsed.registrable} is a known, verified site`,
      };
    }

    return base;
  },
};
