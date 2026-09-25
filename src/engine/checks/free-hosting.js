/**
 * `free-hosting` — the site lives on a platform where anyone can publish in under a minute.
 *
 * `*.vercel.app`, `*.pages.dev`, `*.blogspot.com`, `*.godaddysites.com` and the rest give any
 * anonymous account a real subdomain, a valid certificate, and the platform's clean reputation.
 * Over half of the live phishing we measured in the OpenPhish feed sat on one of them, and the
 * engine used to read every one as safe — worse than neutral, because parse.js treats these as
 * public suffixes (correctly, so tenants never inherit each other's reputation), which also made
 * them look like shallow, ordinary domains to every other check.
 *
 * Alone this is a weak signal and stays below the caution line: plenty of honest projects live on
 * github.io. It exists to stack — a free page plus a brand name, a sign-in word, or plain http is
 * the phishing kit shape. A brand named in the *path* of a free page (`…github.io/Instagram-profil/`,
 * `…/AdobeInstaller.html`) is the one combination this check escalates on its own, because on a
 * platform where the owner is anonymous, nothing else ties the page to that brand.
 */

import { WEIGHTS } from '../scoring.js';
import { findBrand, wordTokens } from '../brands.js';

export default {
  id: 'free-hosting',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'free-hosting', hit: false, weight: 0, reason: '' };
    if (!parsed.hosting) return base;

    const weight = WEIGHTS['free-hosting'];
    let path = parsed.path;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* a malformed escape is still readable as-is */
    }

    const inPath = findBrand(wordTokens(path), parsed);
    if (inPath?.exact) {
      return {
        ...base,
        hit: true,
        weight: weight * 2,
        reason: `A free ${parsed.hosting} page using ${inPath.brand.label}'s name — not ${inPath.brand.domain}`,
      };
    }

    return {
      ...base,
      hit: true,
      weight,
      reason: `Hosted on ${parsed.hosting} — anyone can publish a site there in minutes`,
    };
  },
};
