/**
 * `typosquat` — the registrable domain is one or two edits away from a well-known brand.
 *
 * Catches `paypa1.com`, `g00gle.com`, `micros0ft-support.com`, `exarnple.com`. The comparison runs
 * on the *label* (the part before the public suffix), because `paypa1.com` and `paypa1.net` are
 * the same attack and the TLD tells us nothing.
 *
 * Three guards stop this from becoming a false-positive engine — it is the highest-weight check
 * that fires on ordinary-looking domains, so being wrong here is expensive:
 *
 *   1. Exact matches never fire. `example.com` is not a typosquat of itself, and a brand on a
 *      different TLD is a weaker, different signal that we do not claim here.
 *   2. Short labels are skipped. Every 4-letter word is 2 edits from every other 4-letter word;
 *      matching them would flag half the internet.
 *   3. Distance is scaled to length. 2 edits in 6 characters is a third of the name — that is a
 *      different word, not a typo. 2 edits in 14 characters is a deliberate near-miss.
 *
 * A homoglyph pass runs first, so `paypa1` → `paypal` is caught as distance 0 after folding, which
 * is stronger evidence than a plain typo: nobody fat-fingers a 1 into an l.
 */

import { WEIGHTS } from '../scoring.js';
import { editDistance, isGatedSuffix } from '../parse.js';
import { BRAND_LIST, isBrandOwned } from '../brands.js';

const MIN_LABEL = 5;

/** Characters chosen specifically because they render like another. Not typos — substitutions. */
const HOMOGLYPHS = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };

/**
 * Letter *pairs* that render as a single other letter at UI sizes. These are the ones that beat
 * a reader who is actually looking: 'exarnple.com' survives a careful glance in a sans-serif font.
 * Folded before the digit pass so 'rn' and '0' can both be undone in one name.
 */
const DIGRAPHS = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
  [/ii/g, 'n'],
];

function foldHomoglyphs(label) {
  let out = label;
  for (const [re, to] of DIGRAPHS) out = out.replace(re, to);
  return out.replace(/[013456789]/g, (d) => HOMOGLYPHS[d] ?? d);
}

/** 'micros0ft-support' → ['micros0ft', 'support']: brands get padded with marketing words. */
function candidateSegments(label) {
  const parts = label.split('-').filter((p) => p.length >= MIN_LABEL);
  return parts.length > 1 ? [label, ...parts] : [label];
}

export default {
  id: 'typosquat',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'typosquat', hit: false, weight: 0, reason: '' };
    const label = parsed.registrableLabel;
    if (!label || label.length < MIN_LABEL) return base;
    if (isGatedSuffix(parsed.tld)) return base; // nobody can register a typo under gov.bd

    let best = null;

    for (const segment of candidateSegments(label)) {
      const folded = foldHomoglyphs(segment);

      for (const brand of BRAND_LIST) {
        if (brand.label.length < MIN_LABEL) continue;

        // Guard 1: the genuine domain is not a typosquat of itself. An exact label on a domain the
        // brand does *not* own ('roblox.ly') is not a typo either — that is brand-impersonation's.
        if (isBrandOwned(parsed, brand) || parsed.registrableLabel === brand.label) return base;
        if (brand.notTypos?.includes(segment)) continue;

        const raw = editDistance(segment, brand.label, 2);
        const homoglyph = editDistance(folded, brand.label, 2);
        const distance = brand.homoglyphOnly ? (homoglyph === 0 && raw > 0 ? 0 : 3) : Math.min(raw, homoglyph);
        if (distance === 0 && segment === brand.label) continue; // exact — see guard 1
        if (distance > 2) continue;

        // Guard 3: distance must be small *relative to* the brand's length.
        const tolerance = brand.label.length >= 10 ? 2 : 1;
        if (distance > tolerance) continue;

        const viaHomoglyph = homoglyph < raw || (homoglyph === 0 && raw > 0);
        if (!best || distance < best.distance) best = { brand, distance, viaHomoglyph };
      }
    }

    if (!best) return base;

    return {
      ...base,
      hit: true,
      // A character swapped for a lookalike is intent, not accident — weight it higher.
      weight: best.viaHomoglyph ? WEIGHTS.typosquat : WEIGHTS.typosquat * 0.9,
      reason: `Looks like ${best.brand.domain} but is not — check the spelling carefully`,
    };
  },
};
