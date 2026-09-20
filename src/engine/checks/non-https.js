/**
 * `non-https` — the scheme is insecure, or is not a navigation at all.
 *
 * Two very different problems share one check id because they share one question: "can I trust
 * what happens when this is clicked?"
 *   • http: — content is readable and rewritable in transit. A weak signal alone, a serious one
 *     on a credential page, so the weight escalates when the path looks like a login.
 *   • javascript: / data: / vbscript: — clicking runs code or renders attacker-authored content
 *     in the page's own origin. There is no benign use of these in a link a user hovers.
 */

import { WEIGHTS } from '../scoring.js';
import { DANGEROUS_SCHEMES } from '../parse.js';

const CREDENTIAL_PATH = /(login|signin|sign-in|log-in|account|verify|secure|auth|password|wallet|billing|payment|update)/i;

/**
 * Grade a non-navigating scheme by what it can actually do to the user. A flat "all dangerous"
 * tier is wrong in both directions:
 *
 * - `javascript:` with a body runs in the page's own origin, which the site already controls, so
 *   it grants no new capability. Earns "check this", not "you are being robbed". Inert forms such
 *   as `javascript:void(0)` never reach here — parse.js drops them.
 * - `vbscript:` has no legitimate remaining use; it appears only in legacy IE exploitation.
 * - `data:text/html` renders attacker-authored markup. Chrome has blocked top-level `data:`
 *   navigation from links since Chrome 60, so the realistic path is a context-menu open.
 *
 * Copy invites verification rather than asserting harm: a warning the user cannot act on is a
 * warning they learn to dismiss.
 */
function gradeScheme(parsed) {
  const base = WEIGHTS['non-https'];
  const scheme = parsed.scheme;

  if (scheme === 'vbscript:') {
    return { weight: base * 4, reason: 'Uses a legacy script type that no normal site uses' };
  }

  if (scheme === 'data:') {
    const isMarkup = /^data:\s*(text\/html|image\/svg\+xml)/i.test(parsed.raw);
    return isMarkup
      ? { weight: base * 4, reason: 'Opens a page built into the link itself, not a real website' }
      : { weight: base * 2, reason: 'Carries its content inside the link instead of pointing at a site' };
  }

  if (scheme === 'file:') {
    return { weight: base * 2, reason: 'Opens a file on your computer instead of a website' };
  }

  // javascript: with an actual body.
  return {
    weight: base * 3,
    reason: 'Runs code on this page instead of opening a link — check you trust this site',
  };
}

export default {
  id: 'non-https',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'non-https', hit: false, weight: 0, reason: '' };

    if (DANGEROUS_SCHEMES.has(parsed.scheme)) {
      const { weight, reason } = gradeScheme(parsed);
      return { ...base, hit: true, weight, reason };
    }

    if (parsed.scheme !== 'http:') return base;

    const credential = CREDENTIAL_PATH.test(parsed.path);
    return {
      ...base,
      hit: true,
      weight: credential ? WEIGHTS['non-https'] * 2 : WEIGHTS['non-https'],
      reason: credential
        ? 'Asks for sign-in details over an unencrypted connection'
        : 'Unencrypted connection — traffic can be read or altered',
    };
  },
};
