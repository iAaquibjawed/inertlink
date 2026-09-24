/**
 * `deceptive-subdomain` — a brand name appears in the host, but not as the actual domain.
 *
 * `paypal.com.secure-login.ru` is owned by whoever owns `secure-login.ru`. The brand is just text
 * in a subdomain, free to register, and it sits at the start of the string where people stop
 * reading. Chrome's omnibox greys out subdomains for exactly this reason — but a link on a page
 * has no omnibox, which is the gap this extension fills.
 *
 * The check is deliberately narrow: the brand must appear as a whole label (or a `brand.tld`
 * pair) in the subdomain portion, and the registrable domain must NOT be the brand's. That second
 * condition is what keeps `accounts.google.com` silent — the brand is in the host because it *is*
 * the brand.
 */

import { WEIGHTS } from '../scoring.js';
import { truncateHost, areSisterDomains } from '../parse.js';
import BRANDS from '../data/top-brands.json';

export default {
  id: 'deceptive-subdomain',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'deceptive-subdomain', hit: false, weight: 0, reason: '' };
    if (!parsed.registrable || parsed.labels.length < 3) return base;

    // Everything to the left of the registrable domain. That is the attacker-controlled free text.
    const suffixLabels = parsed.registrable.split('.').length;
    const subdomain = parsed.labels.slice(0, parsed.labels.length - suffixLabels);
    if (subdomain.length === 0) return base;

    for (const brand of BRANDS.brands) {
      // The real thing — `paypal.com` under `paypal.com` or regional ccTLD (`paypal.co.uk`) is not deception.
      if (parsed.registrable === brand.domain || parsed.registrableLabel === brand.label) continue;

      // Sister domains of the same entity (e.g. `outlook.office.com`, `jira.atlassian.net`, `github.github.io`)
      if (areSisterDomains(brand.domain, parsed.registrable)) continue;

      const brandLabel = brand.label;
      const brandTld = brand.domain.slice(brandLabel.length + 1);

      const labelHit = subdomain.includes(brandLabel);
      // `paypal.com.evil.ru` — the full brand domain sitting in the subdomain is the strongest form.
      const domainHit = subdomain.join('.').includes(`${brandLabel}.${brandTld}`);
      if (!labelHit && !domainHit) continue;

      return {
        ...base,
        hit: true,
        weight: domainHit ? WEIGHTS['deceptive-subdomain'] : WEIGHTS['deceptive-subdomain'] * 0.8,
        reason: `"${brandLabel}" is only a prefix here — the real site is ${truncateHost(
          parsed.registrable,
          26
        )}`,
      };
    }

    return base;
  },
};
