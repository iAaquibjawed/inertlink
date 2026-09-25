/**
 * InertLink detection engine — PURE (CLAUDE.md golden rule 5).
 *
 * No DOM. No `chrome.*`. No `fetch`. This module is imported by both the content script and the
 * service worker, and is the only part of the codebase covered by unit tests. Keep it that way:
 * if you find yourself needing a browser API here, the API call belongs in the caller.
 */

import { VERDICT } from '../shared/messages.js';
import { CHECKS } from './checks/registry.js';
import { scoreToVerdict } from './scoring.js';
import { parseUrl, hostMatches } from './parse.js';
import { SENSITIVITY } from '../shared/settings.js';

/**
 * Webmail hosts. A link read inside one of these arrived by email — the channel almost every
 * phishing link uses — so the engine judges it one sensitivity step stricter (ADR-0019). The
 * user's own choice still anchors it: 'relaxed' becomes 'balanced', never 'strict'.
 */
const WEBMAIL = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.aol.com',
  'mail.proton.me',
  'app.fastmail.com',
  'mail.zoho.com',
  'www.icloud.com',
];
const STRICTER = {
  [SENSITIVITY.RELAXED]: SENSITIVITY.BALANCED,
  [SENSITIVITY.BALANCED]: SENSITIVITY.STRICT,
  [SENSITIVITY.STRICT]: SENSITIVITY.STRICT,
};

/** The sensitivity actually applied: the user's, tightened by one step inside webmail. */
export function effectiveSensitivity(sensitivity = SENSITIVITY.BALANCED, pageHost = '') {
  const inMail = WEBMAIL.some((h) => hostMatches(pageHost, h));
  return inMail ? (STRICTER[sensitivity] ?? SENSITIVITY.STRICT) : sensitivity;
}

/**
 * @typedef {Object} CheckResult
 * @property {string}  id      Stable check id, matches the filename in checks/.
 * @property {boolean} hit     Did the signal fire?
 * @property {number}  weight  Contribution to the risk score when hit.
 * @property {string}  reason  Human-readable, shown in the badge. Say *why*, not *what*.
 */

/**
 * @typedef {Object} EngineVerdict
 * @property {import('../shared/messages.js').Verdict} verdict
 * @property {number}        score     Summed weights of all hits.
 * @property {CheckResult[]} signals   Every check that fired, strongest first.
 * @property {boolean}       borderline Should Layer 2 (reputation API) be consulted?
 * @property {boolean}       suppressNetwork Hard "never send this host anywhere" flag.
 * @property {import('./parse.js').ParsedUrl|null} parsed
 */

/**
 * Evaluate a URL against every registered Layer-1 check.
 *
 * @param {string} rawUrl        The href, exactly as it appears in the DOM.
 * @param {Object} [context]     Optional page context.
 * @param {string} [context.anchorText]   Visible link text — powers `text-href-mismatch`.
 * @param {string} [context.pageHost]     Host of the page the link sits on.
 * @param {string} [context.pageUrl]      Page URL, so relative hrefs resolve. Never fetched.
 * @param {string} [context.sensitivity]  'strict' | 'balanced' | 'relaxed'.
 * @param {string[]} [context.userAllowlist]
 * @param {string[]} [context.userBlocklist]
 * @param {string[]} [context.remoteBlocklist]
 * @returns {EngineVerdict}
 */
export function evaluate(rawUrl, context = {}) {
  const parsed = parseUrl(rawUrl, context.pageUrl);
  if (!parsed) {
    return {
      verdict: VERDICT.UNKNOWN,
      score: 0,
      signals: [],
      borderline: false,
      suppressNetwork: true,
      parsed: null,
    };
  }

  const signals = [];
  for (const check of CHECKS) {
    try {
      const result = check.run(parsed, context);
      if (result?.hit) signals.push(result);
    } catch {
      // Fail safe, fail quiet (golden rule 6): one broken check must not void the verdict.
    }
  }

  signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const score = signals.reduce((sum, s) => sum + s.weight, 0);

  const verdict = scoreToVerdict(score, signals, effectiveSensitivity(context.sensitivity, context.pageHost), {
    checksRun: CHECKS.length,
  });
  return { ...verdict, parsed, wrapper: parsed.wrapper ?? null };
}

/**
 * The one line the badge shows. Negative-weight signals (the allowlist) explain a *safe* verdict,
 * so they are only surfaced when nothing worse fired. If the link was unwrapped from an email
 * security gateway, the wrapper is surfaced in the reason.
 *
 * @param {EngineVerdict} verdict
 * @returns {string}
 */
export function primaryReason(verdict) {
  const risky = verdict.signals?.filter((s) => s.weight > 0) ?? [];
  let reason = '';
  if (risky.length) {
    reason = risky[0].reason;
  } else if (verdict.signals?.length) {
    reason = verdict.signals[0]?.reason ?? '';
  }

  const wrapper = verdict.parsed?.wrapper ?? verdict.wrapper;
  if (wrapper) {
    if (reason) {
      return `${reason} (via ${wrapper.name})`;
    }
    return `via ${wrapper.name}`;
  }

  return reason;
}

export { parseUrl, truncateHost, hostMatches, unwrapUrl } from './parse.js';
export { CHECKS } from './checks/registry.js';
export { THRESHOLDS, WEIGHTS } from './scoring.js';
