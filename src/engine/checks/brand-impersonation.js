/**
 * `brand-impersonation` — a brand's name is part of a domain the brand does not own.
 *
 * This is how most brand phishing actually looks in public feeds (OpenPhish, PhishTank): not a
 * clever typo, but the real name with padding — `snapchat-web.vercel.app`,
 * `whatsapp-indonesia877.blogspot.com`, `xfinityloginxfinity.weebly.com`, `metamask2-eight…`.
 * `typosquat` deliberately skips exact names (a typo needs a difference), and
 * `deceptive-subdomain` only sees a brand that is a *whole* subdomain label, so this shape fell
 * between the two and read as safe.
 *
 * It also closes the brand-on-a-foreign-TLD hole: `roblox.com.do` and `roblox.ly` used to pass
 * as Roblox because their label matched. See `isBrandOwned` for what does count as the brand.
 *
 * Whole-label brands in the subdomain (`paypal.evil.ru`) are left to `deceptive-subdomain`, so
 * the same fact is not counted twice.
 */

import { WEIGHTS } from '../scoring.js';
import { truncateHost, isGatedSuffix } from '../parse.js';
import { BRAND_LIST, findBrand, isBrandOwned, wordTokens } from '../brands.js';

/**
 * On these platforms, an organisation's page at `<brand>.github.io` is almost always the brand
 * itself — GitHub enforces trademark on org names. The exemption is for an *exact* tenant name
 * only; `paypal-login.github.io` still fires.
 */
const ORG_VERIFIED_HOSTING = new Set(['github.io', 'gitlab.io']);

export default {
  id: 'brand-impersonation',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'brand-impersonation', hit: false, weight: 0, reason: '' };
    if (!parsed.registrable || parsed.isIpHost || isGatedSuffix(parsed.tld)) return base;

    const weight = WEIGHTS['brand-impersonation'];
    const real = (brand) => truncateHost(brand.domain, 22);

    // The brand's exact name, on a domain it does not own: 'roblox.ly', 'paypal.xyz'.
    const sameName = BRAND_LIST.find((b) => b.label === parsed.registrableLabel);
    if (sameName && !isBrandOwned(parsed, sameName)) {
      if (ORG_VERIFIED_HOSTING.has(parsed.hosting)) return base;
      return {
        ...base,
        hit: true,
        weight,
        reason: `Not ${sameName.domain} — this is ${truncateHost(parsed.registrable, 26)}, a different site`,
      };
    }

    const suffixLabels = parsed.tld.split('.').length;
    const labels = parsed.labels.slice(0, parsed.labels.length - suffixLabels);
    const subdomainLabels = new Set(labels.slice(0, -1));
    const match = findBrand(labels.flatMap(wordTokens), parsed);
    if (!match) return base;
    if (subdomainLabels.has(match.brand.label)) return base; // deceptive-subdomain's case

    return {
      ...base,
      hit: true,
      // A brand glued to other letters ('googlevideo', 'facebookzaman') is how brands name their
      // own infrastructure as often as how phishers name kits, so alone it stays below caution.
      weight: match.exact ? weight : weight * 0.5,
      reason: `Uses the name "${match.brand.label}" but is not ${real(match.brand)}`,
    };
  },
};
