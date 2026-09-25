/**
 * `credential-lure` — the domain name itself is a call to sign in or fix an account.
 *
 * `verify.your-account-login.com`, `security-server-page--….replit.app`, `wallet-connect-payment.net`.
 * Legitimate companies put words like "login" in a *subdomain* of their own name
 * (`login.salesforce.com`), not in the name they registered. So for ordinary domains we only look
 * at the registrable label; on free-hosting platforms, where the whole tenant name is free text
 * chosen by an anonymous account, we look at every label.
 *
 * Weak on purpose — it is the story the domain tells, not proof. It stacks with brand, hosting,
 * and http signals.
 */

import { WEIGHTS } from '../scoring.js';
import { wordTokens } from '../brands.js';
import TLDS from '../data/tlds.json';
import { isEstablished } from '../popular.js';
import { isGatedSuffix } from '../parse.js';

const LURES = new Set([
  'login', 'logon', 'signin', 'verify', 'verification', 'validate', 'secure', 'security',
  'account', 'accounts', 'update', 'wallet', 'recover', 'recovery', 'unlock', 'suspended',
  'confirm', 'billing', 'authenticate', 'webmail', 'helpdesk', 'support', 'refund', 'claim',
]);

/** Gated registries: `login.gov` is the US government's sign-in service, not a lure. */
const SAFE = new Set(TLDS.safe ?? []);

export default {
  id: 'credential-lure',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'credential-lure', hit: false, weight: 0, reason: '' };
    if (!parsed.registrable || parsed.isIpHost || SAFE.has(parsed.tld) || isGatedSuffix(parsed.tld)) return base;
    // 'securityscorecard.com' and 'loginradius.com' are real companies with millions of visits.
    if (isEstablished(parsed.registrable)) return base;

    const suffixLabels = parsed.tld.split('.').length;
    const owned = parsed.labels.slice(0, parsed.labels.length - suffixLabels);
    const text = parsed.hosting ? owned : [parsed.registrableLabel];
    const word = text.flatMap(wordTokens).find((t) => LURES.has(t));
    if (!word) return base;

    return {
      ...base,
      hit: true,
      weight: WEIGHTS['credential-lure'],
      reason: `The site's name says "${word}" — a common lure to get you to sign in`,
    };
  },
};
