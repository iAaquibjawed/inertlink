/**
 * `suspicious-tld` — the top-level domain is one where abuse is concentrated.
 *
 * This is the weakest signal in the registry and it is meant to stay that way. Millions of
 * legitimate sites use cheap TLDs; firing red on `.xyz` alone would be indefensible. Its job is
 * to push an already-suspicious link over the line, not to condemn one on its own.
 *
 * Tiers come from `data/tlds.json`. `.zip` and `.mov` sit at the top tier not because of abuse
 * volume but because the TLD *is* the attack: `invoice.zip` reads as a filename, and a link that
 * looks like a download is a link people click without thinking.
 */

import { WEIGHTS } from '../scoring.js';
import TLDS from '../data/tlds.json';

const TIER = new Map();
for (const [tier, list] of Object.entries(TLDS.risky ?? {})) {
  for (const tld of list) TIER.set(tld, Number(tier));
}
const SAFE = new Set(TLDS.safe ?? []);

const FILENAME_TLDS = new Set(['zip', 'mov']);

export default {
  id: 'suspicious-tld',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'suspicious-tld', hit: false, weight: 0, reason: '' };
    if (!parsed.tld || parsed.isIpHost) return base;

    // Gated registries (.gov, .bank, .edu) can't be bought by an attacker. Silence, not a bonus.
    if (SAFE.has(parsed.tld)) return base;

    const lastLabel = parsed.tld.split('.').pop();
    const tier = TIER.get(parsed.tld) ?? TIER.get(lastLabel);
    if (!tier) return base;

    return {
      ...base,
      hit: true,
      weight: (WEIGHTS['suspicious-tld'] * tier) / 2,
      reason: FILENAME_TLDS.has(lastLabel)
        ? `".${lastLabel}" is a web address that looks like a downloadable file`
        : `".${lastLabel}" addresses are cheap to register and often used for scams`,
    };
  },
};
