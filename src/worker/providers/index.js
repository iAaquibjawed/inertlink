/**
 * Reputation provider interface (PLAN.md §2, Layer 2).
 *
 * Every provider implements:
 *   check(host: string, opts: { apiKey?: string }) => Promise<{ verdict, source, reasons, ttl? }>
 *
 * Providers receive a **host**, never a full URL — query strings carry session tokens, reset
 * links, and search terms, and none of that may reach a third party (golden rule 2). The router
 * in service-worker.js enforces this; providers additionally defend themselves.
 *
 * Adding urlscan.io or PhishTank is one new file plus one line here. No caller changes, because
 * no caller knows which provider it is talking to.
 */

import safebrowsing from './safebrowsing.js';

/** @type {Record<string, { id: string, label: string, requiresKey?: boolean, check: Function }>} */
export const PROVIDERS = {
  [safebrowsing.id]: safebrowsing,
};

export function getProvider(id) {
  return PROVIDERS[id] ?? null;
}

/** Shown in options. Kept here so the UI never hard-codes a provider list that can drift. */
export function listProviders() {
  return Object.values(PROVIDERS).map(({ id, label, requiresKey }) => ({
    id,
    label,
    requiresKey: Boolean(requiresKey),
  }));
}
