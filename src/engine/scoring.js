/**
 * Weights, thresholds, and sensitivity. One place, on purpose (PLAN.md §2) — tuning detection
 * should never mean touching a check.
 *
 * The numbers are calibrated against tests/fixtures/urls.json. That file is the spec; these
 * numbers move to satisfy it, not the reverse.
 */

import { VERDICT } from '../shared/messages.js';
import { SENSITIVITY } from '../shared/settings.js';

/**
 * Per-check weights. Keys are check ids (PLAN.md §2 table).
 * Higher = stronger evidence of harm. Checks scale these by context (a login path, a homoglyph
 * rather than a typo), so the value here is the *base* case.
 */
export const WEIGHTS = Object.freeze({
  'non-https': 10,
  'ip-host': 30,
  'userinfo-trick': 45,
  'punycode-idn': 35,
  typosquat: 50,
  'deceptive-subdomain': 45,
  // Below dangerAt alone: a brand's name on someone else's domain is caution by itself, and
  // danger once it stacks with a free host, a lure word, or plain http.
  'brand-impersonation': 35,
  'free-hosting': 15,
  'credential-lure': 12,
  // Learned model (ADR-0019). The maximum, reached at MODEL_BAND.full; scaled down below it.
  // Deliberately below balanced dangerAt: a learned score is one piece of evidence, so on its
  // own it can say "caution", and red needs a second, independent signal to agree.
  'url-model': 35,
  'suspicious-tld': 15,
  'url-shortener': 20,
  'excessive-subdomains': 15,
  'text-href-mismatch': 40,
  'encoded-obfuscation': 25,
  'nonstandard-port': 15,
  'local-blocklist': 100,
  allowlist: -100,
});

/**
 * How the model's probability maps onto its weight: zero at `floor`, the full weight at `full`,
 * linear between. Calibrated with scripts/model/eval.mjs against real legitimate links with paths
 * — the false-alarm rate on those, not on homepages, is what sets `floor`. `established` is the
 * multiplier on a top-sites domain (popular.js).
 */
export const MODEL_BAND = Object.freeze({ floor: 0.8, full: 0.995, established: 0.25, hosting: 0.5 });

/**
 * Score bands. `[cautionAt, dangerAt]` — below cautionAt is safe, at/above dangerAt is danger,
 * between is caution. `borderline` is the sub-band where Layer 2 earns its network call.
 *
 * The borderline band starts slightly *below* cautionAt and ends at dangerAt. Starting early is
 * deliberate: a link sitting just under the caution line is precisely the case where a provider's
 * answer changes the verdict. Ending at dangerAt is equally deliberate — once we are confident a
 * link is bad we have no question to ask, and asking anyway would send the host somewhere for
 * nothing (golden rule 2). Above and below the band, no network call happens at all.
 */
export const THRESHOLDS = Object.freeze({
  [SENSITIVITY.STRICT]: { cautionAt: 12, dangerAt: 30, borderline: [8, 30] },
  [SENSITIVITY.BALANCED]: { cautionAt: 20, dangerAt: 40, borderline: [15, 40] },
  [SENSITIVITY.RELAXED]: { cautionAt: 30, dangerAt: 55, borderline: [22, 55] },
});

/**
 * Turn a summed score into the verdict the UI renders.
 *
 * @param {number} score
 * @param {import('./index.js').CheckResult[]} signals
 * @param {string} [sensitivity]
 * @param {{ checksRun?: number }} [meta] How many checks actually ran. Zero means we have
 *   established nothing, and `unknown` is the only honest answer (ADR-0006).
 * @returns {import('./index.js').EngineVerdict}
 */
export function scoreToVerdict(score, signals = [], sensitivity = SENSITIVITY.BALANCED, meta = {}) {
  const band = THRESHOLDS[sensitivity] ?? THRESHOLDS[SENSITIVITY.BALANCED];

  // A green shield is a claim. With no checks behind it, it is a false one (ADR-0006).
  if (!meta.checksRun) {
    return { verdict: VERDICT.UNKNOWN, score, signals, borderline: false, suppressNetwork: false };
  }

  const blocked = signals.some((s) => s.id === 'local-blocklist');
  const allowed = signals.some((s) => s.id === 'allowlist');

  // The blocklist is not a contribution to a score, it is an override — and it beats the
  // allowlist, so a domain on both resolves toward warning the user (see checks/local-blocklist.js).
  if (blocked) {
    return { verdict: VERDICT.DANGER, score, signals, borderline: false, suppressNetwork: true };
  }

  let verdict = VERDICT.SAFE;
  if (score >= band.dangerAt) verdict = VERDICT.DANGER;
  else if (score >= band.cautionAt) verdict = VERDICT.CAUTION;

  const [lo, hi] = band.borderline;
  // An allowlisted host is never sent anywhere, whatever its score says.
  const borderline = !allowed && score >= lo && score < hi;

  return { verdict, score, signals, borderline, suppressNetwork: allowed };
}
