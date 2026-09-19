/**
 * `url-shortener` — the destination is hidden behind a redirect service.
 *
 * The verdict here is *uncertainty*, not harm, and the copy has to say so. A `bit.ly` link from a
 * colleague is fine; the problem is that neither we nor the user can see where it goes.
 *
 * We do not and will not resolve it. Following the redirect would be a request to the attacker's
 * server, from the user's IP, triggered by a mouse movement they did not intend as a click — that
 * is golden rule 3, and it is also how you turn a hover into a tracking pixel.
 *
 * Weight is capped below the caution threshold on its own: a shortener alone should read amber,
 * never red.
 */

import { WEIGHTS } from '../scoring.js';
import { hostMatches } from '../parse.js';
import SHORTENERS from '../data/shorteners.json';

const HOSTS = SHORTENERS.hosts ?? [];

export default {
  id: 'url-shortener',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'url-shortener', hit: false, weight: 0, reason: '' };
    if (!parsed.host) return base;

    const match = HOSTS.find((h) => hostMatches(parsed.host, h));
    if (!match) return base;

    return {
      ...base,
      hit: true,
      weight: WEIGHTS['url-shortener'],
      reason: `${match} hides the real destination — we can't check where this goes`,
    };
  },
};
