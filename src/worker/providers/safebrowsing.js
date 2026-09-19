/**
 * Google Safe Browsing — Lookup API v4.
 *
 * MVP provider, behind a user-supplied key and an explicit opt-in that ships OFF (PLAN.md §2).
 *
 * PRIVACY SHAPE — read before changing anything here:
 *   • We send `https://<host>/` and nothing else. Not the path, not the query string. A password
 *     reset link's token, a search term, a document id — none of it reaches Google (golden rule 2).
 *     That costs accuracy for path-specific threats and we accept the trade knowingly.
 *   • One host per request. No batching across hosts: a batch tells the provider which sites the
 *     user looked at *together*, which is a browsing pattern we have no business disclosing.
 *   • The key lives in chrome.storage.sync and is read here, in the worker. It never crosses into
 *     a content script, so it is never in the address space of a page the user is browsing.
 *
 * The Update API (local hash-prefix matching, URL never leaves the device) is the better answer
 * and is the documented Phase-5+ path. It needs a database, a refresh schedule, and rice-coded
 * delta decoding — too much to smuggle into the MVP, but this module's interface does not change
 * when it lands, which is the whole reason providers are pluggable.
 */

import { VERDICT } from '../../shared/messages.js';

const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

/** Map Safe Browsing threat types onto our verdict vocabulary. */
const THREAT_VERDICT = {
  MALWARE: VERDICT.DANGER,
  SOCIAL_ENGINEERING: VERDICT.DANGER,
  UNWANTED_SOFTWARE: VERDICT.CAUTION,
  POTENTIALLY_HARMFUL_APPLICATION: VERDICT.CAUTION,
};

const THREAT_REASON = {
  MALWARE: 'Google Safe Browsing lists this site as distributing malware',
  SOCIAL_ENGINEERING: 'Google Safe Browsing lists this site as phishing',
  UNWANTED_SOFTWARE: 'Google Safe Browsing lists this site as distributing unwanted software',
  POTENTIALLY_HARMFUL_APPLICATION: 'Google Safe Browsing flags apps hosted here as harmful',
};

/** Give up rather than leave a hover spinning. The local verdict is already on screen. */
const TIMEOUT_MS = 4000;

export default {
  id: 'safebrowsing',
  label: 'Google Safe Browsing',
  /** Surfaced in options so the UI can explain why the key field exists. */
  requiresKey: true,

  /**
   * @param {string} host Host only — callers must never pass a full URL (golden rule 2).
   * @param {{ apiKey?: string }} opts
   * @returns {Promise<{ verdict: string, source: string, reasons: string[], ttl?: number }>}
   */
  async check(host, { apiKey } = {}) {
    const unknown = { verdict: VERDICT.UNKNOWN, source: 'safebrowsing', reasons: [] };
    if (!host || !apiKey) return unknown;

    // Defensive: if a caller ever hands us a URL, strip it back to the host rather than leaking it.
    const cleanHost = String(host).split('/')[0].split('?')[0].toLowerCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        // No credentials, no cookies. This request must not carry the user's Google session.
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({
          client: { clientId: 'linkverify', clientVersion: '0.1.0' },
          threatInfo: {
            threatTypes: Object.keys(THREAT_VERDICT),
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: `https://${cleanHost}/` }],
          },
        }),
      });

      if (!res.ok) return unknown; // 400 = bad key, 403 = quota. Neither is the user's problem.

      const data = await res.json();
      const matches = data?.matches ?? [];
      if (matches.length === 0) {
        // "Not on the list" is genuinely useful — it is what lets a borderline link settle green.
        return { verdict: VERDICT.SAFE, source: 'safebrowsing', reasons: [] };
      }

      // Worst match wins. A host flagged both UNWANTED_SOFTWARE and MALWARE is malware.
      const worst = matches.find((m) => THREAT_VERDICT[m.threatType] === VERDICT.DANGER) ?? matches[0];
      return {
        verdict: THREAT_VERDICT[worst.threatType] ?? VERDICT.CAUTION,
        source: 'safebrowsing',
        reasons: [THREAT_REASON[worst.threatType] ?? 'Listed by Google Safe Browsing'],
      };
    } catch {
      // Offline, aborted, blocked by a firewall — all identical from here, and all mean
      // "fall back to the local verdict" (golden rule 6).
      return unknown;
    } finally {
      clearTimeout(timer);
    }
  },
};
