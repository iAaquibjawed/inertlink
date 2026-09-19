/**
 * `local-blocklist` — the host is on a list of known-bad domains.
 *
 * Two sources, merged: the bundled `data/blocklist.json` and whatever the user typed into their
 * own blocklist (passed in via `context.userBlocklist`, because the engine never touches
 * chrome.storage — golden rule 5).
 *
 * A hit here is decisive and deliberately outranks the allowlist. If a domain is on both lists,
 * something is wrong, and "wrong" should resolve toward warning the user. That asymmetry is the
 * whole safety argument: over-warning costs a click, under-warning costs an account.
 *
 * Matching is host-or-parent, so one entry covers every subdomain an attacker spins up.
 */

import { WEIGHTS } from '../scoring.js';
import { hostMatches } from '../parse.js';
import BLOCKLIST from '../data/blocklist.json';

const BUNDLED = BLOCKLIST.hosts ?? [];

export default {
  id: 'local-blocklist',

  /**
   * @param {import('../parse.js').ParsedUrl} parsed
   * @param {{ userBlocklist?: string[], remoteBlocklist?: string[] }} context
   */
  run(parsed, context = {}) {
    const base = { id: 'local-blocklist', hit: false, weight: 0, reason: '' };
    if (!parsed.host) return base;

    const user = context.userBlocklist ?? [];
    const remote = context.remoteBlocklist ?? [];

    if (user.some((h) => hostMatches(parsed.host, h))) {
      return {
        ...base,
        hit: true,
        weight: WEIGHTS['local-blocklist'],
        reason: 'You added this site to your blocklist',
      };
    }

    const match =
      BUNDLED.find((h) => hostMatches(parsed.host, h)) ??
      remote.find((h) => hostMatches(parsed.host, h));
    if (!match) return base;

    return {
      ...base,
      hit: true,
      weight: WEIGHTS['local-blocklist'],
      reason: 'This site is on a known-phishing list',
    };
  },
};
