/**
 * `userinfo-trick` — an `@` in the authority hides the real destination.
 *
 * `https://paypal.com@evil.ru/verify` navigates to **evil.ru**. Everything before the `@` is a
 * username the browser discards. The user reads left to right, sees their bank first, and stops
 * reading. This is one of the oldest tricks in phishing and it still works because the URL is
 * genuinely, technically valid.
 *
 * There is no benign use of userinfo in a link on a web page — HTTP basic-auth-in-URL has been
 * deprecated by every browser. So this fires at full weight with no escalation logic.
 */

import { WEIGHTS } from '../scoring.js';
import { truncateHost } from '../parse.js';

export default {
  id: 'userinfo-trick',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'userinfo-trick', hit: false, weight: 0, reason: '' };
    if (!parsed.userinfo) return base;

    return {
      ...base,
      hit: true,
      weight: WEIGHTS['userinfo-trick'],
      // Naming the real host is the entire value of this signal. "Suspicious link" teaches
      // nothing; "actually goes to evil.ru" is a fact the user can act on.
      reason: `The text before "@" is fake — this actually goes to ${truncateHost(parsed.host, 28)}`,
    };
  },
};
