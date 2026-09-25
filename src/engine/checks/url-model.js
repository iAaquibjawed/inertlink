/**
 * `url-model` — the address is shaped like phishing the model learned from (ADR-0019).
 *
 * The other checks are rules someone wrote down. This one is learned: a logistic regression over
 * hundreds of thousands of labelled URLs (public phishing feeds vs. real links cited on
 * Wikipedia and the top-sites list), trained offline by `scripts/model/train.mjs`. Its job is
 * the phish nobody has reported yet — no blocklist knows it, and no single rule fires on it, but
 * its name, path, and parameters look like thousands of kits that came before it.
 *
 * Still pure and offline (golden rules 1, 2, 5): the weights are static data in the bundle, and
 * scoring is a few hundred additions. Nothing about the URL leaves the device.
 *
 * The probability becomes a weight on a ramp (MODEL_BAND in scoring.js), not a yes/no: a 0.7 is
 * a nudge that stacks with other signals, a 0.98 is enough by itself.
 */

import { WEIGHTS, MODEL_BAND } from '../scoring.js';
import { decodeModel, explain } from '../model/score.js';
import { isLocalHost, isGatedSuffix } from '../parse.js';
import { isEstablished } from '../popular.js';
import MODEL from '../data/url-model.json';

/** Decoded on first use, so a page where nothing is hovered never pays for it. */
let decoded = null;

const WHERE = {
  host: 'its name',
  path: 'the page path',
  query: 'its parameters',
};

export default {
  id: 'url-model',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'url-model', hit: false, weight: 0, reason: '' };
    // The model learned the open internet. A router's /admin page is not a phishing kit.
    if (!parsed.host || isLocalHost(parsed.host)) return base;

    decoded ??= decodeModel(MODEL);
    const hashAt = parsed.raw.indexOf('#');
    const { probability, part } = explain(parsed, decoded, hashAt === -1 ? '' : parsed.raw.slice(hashAt));

    const ramp = (probability - MODEL_BAND.floor) / (MODEL_BAND.full - MODEL_BAND.floor);
    let weight = WEIGHTS['url-model'] * Math.min(Math.max(ramp, 0), 1);
    // On an established domain a login-shaped path is almost always the site's own login page.
    // Discounted, not silenced: a compromised popular site still stacks with any other signal.
    if (isEstablished(parsed.registrable) || isGatedSuffix(parsed.tld)) weight *= MODEL_BAND.established;
    // On a free host, `free-hosting` already speaks for the platform, and nearly every hosted URL
    // in the public training data is phish — so the model over-reads any tenant-style name there.
    // Softened so the two do not count one fact twice; it still stacks with a brand or a lure.
    if (parsed.hosting) weight *= MODEL_BAND.hosting;
    if (weight < 1) return base;

    return {
      ...base,
      hit: true,
      weight: Math.round(weight * 10) / 10,
      probability,
      reason: `Built like known phishing links — especially ${WHERE[part]}`,
    };
  },
};
