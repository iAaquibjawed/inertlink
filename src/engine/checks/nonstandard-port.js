/**
 * `nonstandard-port` — the link specifies an explicit, unusual port.
 *
 * Real consumer services run on 80/443. A sign-in page on `:8081` is either someone's dev box or
 * a kit deployed on a host where the operator does not control the web root — both mean "this is
 * not the company you think it is".
 *
 * Localhost and private ranges are exempt (that is `ip-host`'s carve-out too): developers hover
 * `localhost:3000` all day and a warning there is pure noise.
 */

import { WEIGHTS } from '../scoring.js';

/** Ports common enough in legitimate public use that flagging them is noise. */
const TOLERATED = new Set(['', '80', '443', '8443']);

const LOCAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/;

const CREDENTIAL_PATH = /(login|signin|sign-in|account|verify|secure|auth|password|pay|billing)/i;

export default {
  id: 'nonstandard-port',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'nonstandard-port', hit: false, weight: 0, reason: '' };
    if (TOLERATED.has(parsed.port)) return base;
    if (LOCAL.test(parsed.host)) return base;

    const credential = CREDENTIAL_PATH.test(parsed.path);
    return {
      ...base,
      hit: true,
      weight: credential ? WEIGHTS['nonstandard-port'] * 2 : WEIGHTS['nonstandard-port'],
      reason: credential
        ? `A sign-in page served on port ${parsed.port} — real ones don't do this`
        : `Served on port ${parsed.port} instead of the normal web port`,
    };
  },
};
