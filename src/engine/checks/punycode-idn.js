/**
 * `punycode-idn` — the hostname uses internationalised characters that can impersonate ASCII.
 *
 * `аpple.com` with a Cyrillic а is a different domain from `apple.com` and renders identically in
 * most fonts. Browsers encode it as `xn--pple-43d.com`. Chrome already refuses to display some of
 * these, but coverage is partial and depends on the script mix.
 *
 * Nuance that keeps this from being xenophobic nonsense: an IDN is not suspicious. A Japanese
 * domain in Japanese characters is normal and correct. What is suspicious is an IDN whose decoded
 * form could be *mistaken for* ASCII — so we weight on the homograph risk, not on the mere
 * presence of non-ASCII.
 */

import { WEIGHTS } from '../scoring.js';

/**
 * Punycode labels whose payload is mostly Latin-lookalike. `xn--pypal-4ve` decodes to a word that
 * reads as English; `xn--wgbh1c` (مصر) does not. The heuristic: a short ASCII-ish prefix in the
 * encoded label means the original was mostly Latin letters with one or two substitutions, which
 * is the homograph attack shape.
 */
function looksLikeHomograph(label) {
  const payload = label.slice(4); // strip 'xn--'
  const [basic] = payload.split('-');
  if (!basic) return false;
  // A meaningful run of ASCII letters survived encoding → the name was written to read as English.
  return /^[a-z0-9]{3,}$/.test(basic);
}

export default {
  id: 'punycode-idn',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'punycode-idn', hit: false, weight: 0, reason: '' };
    if (!parsed.hasPunycode) return base;

    const encoded = parsed.labels.filter((l) => l.startsWith('xn--'));
    const homograph = encoded.some(looksLikeHomograph);

    return {
      ...base,
      hit: true,
      weight: homograph ? WEIGHTS['punycode-idn'] : WEIGHTS['punycode-idn'] * 0.4,
      reason: homograph
        ? 'The address uses letters from another alphabet that look like English ones'
        : 'The address uses non-English characters — check it is the site you expect',
    };
  },
};
