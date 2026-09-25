/**
 * Brand matching shared by `brand-impersonation`, `free-hosting`, and `typosquat`. Pure.
 *
 * One answer to "is this host the brand's own?" lives here so the checks cannot disagree about
 * it. They used to: `typosquat` and `deceptive-subdomain` each treated *any* domain whose label
 * equals a brand as genuine, so `roblox.com.do`, `roblox.ly`, and `paypal.xyz` all passed as the
 * real thing (golden rule: the whole point of this product is trust — a green badge on a brand's
 * name on someone else's domain is the worst answer we can give).
 */

import BRANDS from './data/top-brands.json';
import TLDS from './data/tlds.json';
import { areSisterDomains } from './parse.js';

export const BRAND_LIST = BRANDS.brands ?? [];

const RISKY_TLDS = new Set(Object.values(TLDS.risky ?? {}).flat());

/**
 * Shortest brand label we match as a whole token. Below this, brand names are ordinary syllables
 * ('att', 'ups') and a token match is noise.
 */
const MIN_TOKEN = 4;

/**
 * Shortest brand label we match as a *prefix or suffix* of a token ('facebookzaman',
 * 'robloxk'). Five-letter brands are excluded on purpose: 'apple' starts 'applebees' and 'chase'
 * ends 'purchase', and neither is phishing.
 */
const MIN_AFFIX = 6;

/**
 * Split host labels or a path into lowercase alphabetic words. Digits, hyphens, underscores, and
 * dots are all separators: attackers pad brands with exactly those ('metamask2-eight',
 * 'shopee-tbk887', 'Amazon_Clone_Website').
 *
 * @param {string} s
 * @returns {string[]}
 */
export function wordTokens(s) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Does this parsed URL belong to `brand`?
 *
 * True for the brand's registrable domain, a sister domain, and — for brands flagged `regional`
 * — the brand's label on a two-letter country TLD (`amazon.de`, `paypal.co.uk`). Never true for
 * a brand's label on a gTLD or a high-abuse ccTLD: `paypal.xyz` and `google.tk` are not regional
 * sites.
 *
 * @param {import('./parse.js').ParsedUrl} parsed
 * @param {{ label: string, domain: string, regional?: boolean }} brand
 */
export function isBrandOwned(parsed, brand) {
  if (!parsed.registrable) return false;
  if (parsed.registrable === brand.domain) return true;
  if (areSisterDomains(brand.domain, parsed.registrable)) return true;
  if (parsed.hosting) return false; // 'paypal.vercel.app' is a tenant, never the brand
  if (!brand.regional || parsed.registrableLabel !== brand.label) return false;

  const cc = parsed.tld.split('.').pop();
  return cc.length === 2 && !RISKY_TLDS.has(cc);
}

/**
 * Find a brand name used as a word inside `tokens`.
 *
 * @param {string[]} tokens From `wordTokens`.
 * @param {import('./parse.js').ParsedUrl} parsed Brands this URL genuinely belongs to are skipped.
 * @returns {{ brand: object, exact: boolean }|null} `exact` when a token *is* the brand name.
 */
export function findBrand(tokens, parsed) {
  let affix = null;
  for (const brand of BRAND_LIST) {
    const name = brand.label;
    if (name.length < MIN_TOKEN) continue;
    if (isBrandOwned(parsed, brand)) continue;

    for (const t of tokens) {
      if (t === name) return { brand, exact: true };
      if (!affix && name.length >= MIN_AFFIX && t.length > name.length && (t.startsWith(name) || t.endsWith(name))) {
        affix = { brand, exact: false };
      }
    }
  }
  return affix;
}
