/**
 * The permission → registration filter.
 *
 * This function decides whether the extension runs at all. Every bug in it looks identical from
 * the outside — "LinkVerify is broken" — with nothing in the console, so it gets its own tests
 * rather than being trusted because it is short.
 */

import { describe, expect, it } from 'vitest';
import { ALL_SITES, isAllSites, registerableOrigins, originPattern } from '../src/shared/origins.js';

describe('originPattern', () => {
  it('turns a page URL into a match pattern', () => {
    expect(originPattern('https://www.amazon.com/dp/B000?x=1')).toBe('https://www.amazon.com/*');
    expect(originPattern('http://localhost:8787/a/b')).toBe('http://localhost:8787/*');
  });

  it('refuses opaque origins instead of emitting "null/*"', () => {
    // The bug this exists to prevent: new URL('file:///x').origin === 'null', and
    // permissions.request({ origins: ['null/*'] }) rejects — which read as "the button is broken".
    expect(originPattern('file:///Users/me/page.html')).toBe(null);
    expect(originPattern('not a url')).toBe(null);
    expect(originPattern('')).toBe(null);
  });
});

describe('isAllSites', () => {
  it('needs both schemes, not just one', () => {
    expect(isAllSites(ALL_SITES)).toBe(true);
    expect(isAllSites(['https://*/*'])).toBe(false);
    expect(isAllSites([])).toBe(false);
  });
});

describe('registerableOrigins', () => {
  it('passes through specific http(s) origins', () => {
    expect(registerableOrigins(['https://a.example/*', 'http://b.example/*'])).toEqual([
      'https://a.example/*',
      'http://b.example/*',
    ]);
  });

  it('drops anything that cannot host a content script', () => {
    expect(
      registerableOrigins(['file:///*', 'chrome://settings/*', 'https://ok.example/*'])
    ).toEqual(['https://ok.example/*']);
  });

  it('collapses to the broad patterns when they are granted', () => {
    // Registering https://*/* alongside a specific https host is the same script twice on that
    // host. Chrome tolerates it; the duplicate just hides what is really registered.
    const out = registerableOrigins([...ALL_SITES, 'https://a.example/*']);
    expect(out).toEqual(ALL_SITES);
  });

  it('returns nothing when nothing is granted, so nothing is registered', () => {
    expect(registerableOrigins([])).toEqual([]);
    expect(registerableOrigins(['file:///*'])).toEqual([]);
  });
});
