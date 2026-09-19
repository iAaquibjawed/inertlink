/**
 * The check registry. Every Layer-1 heuristic registers here and nowhere else.
 *
 * Adding a signal is: one file in this directory + one entry below + fixtures in
 * tests/fixtures/urls.json. Never a branch in a growing if-tree (CLAUDE.md §4).
 *
 * Each check module default-exports:
 *   { id: string, run(parsed: ParsedUrl, context: object): CheckResult }
 *
 * Order in this array does not affect scoring — weights are summed, not short-circuited — but it
 * is kept roughly strongest-first so a reader sees the decisive checks before the contributing
 * ones.
 */

import allowlist from './allowlist.js';
import localBlocklist from './local-blocklist.js';
import userinfoTrick from './userinfo-trick.js';
import typosquat from './typosquat.js';
import deceptiveSubdomain from './deceptive-subdomain.js';
import textHrefMismatch from './text-href-mismatch.js';
import punycodeIdn from './punycode-idn.js';
import ipHost from './ip-host.js';
import encodedObfuscation from './encoded-obfuscation.js';
import urlShortener from './url-shortener.js';
import suspiciousTld from './suspicious-tld.js';
import excessiveSubdomains from './excessive-subdomains.js';
import nonstandardPort from './nonstandard-port.js';
import nonHttps from './non-https.js';

/** @type {Array<{ id: string, run: (parsed: any, context: any) => any }>} */
export const CHECKS = [
  localBlocklist,
  allowlist,
  userinfoTrick,
  typosquat,
  deceptiveSubdomain,
  textHrefMismatch,
  punycodeIdn,
  ipHost,
  encodedObfuscation,
  urlShortener,
  suspiciousTld,
  excessiveSubdomains,
  nonstandardPort,
  nonHttps,
];

/** Guards against two checks shipping the same id — which would silently break scoring. */
export function assertUniqueIds(checks = CHECKS) {
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.id)) throw new Error(`Duplicate check id: ${check.id}`);
    seen.add(check.id);
  }
  return true;
}
