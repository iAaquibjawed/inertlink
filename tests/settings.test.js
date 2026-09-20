/**
 * Settings sanitisation.
 *
 * `writeSettings` is reachable from any extension surface, and until it validated its input it
 * would write whatever it was handed straight into chrome.storage.sync. These tests pin the two
 * properties that matter: unknown keys never land, and a wrong-typed value never replaces a
 * right-typed default.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeSettings, DEFAULT_SETTINGS, SENSITIVITY } from '../src/shared/settings.js';

describe('sanitizeSettings', () => {
  it('drops keys that are not real settings', () => {
    const out = sanitizeSettings({ enabled: false, notASetting: 'x', __proto__: { polluted: 1 } });
    expect(out).toEqual({ enabled: false });
    expect(out.notASetting).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it('rejects wrong types rather than storing them', () => {
    // A string where an array belongs makes every `.some()` in the engine throw — which the
    // checks catch and swallow, silently disabling a signal.
    expect(sanitizeSettings({ allowlist: 'evil.example' })).toEqual({});
    expect(sanitizeSettings({ enabled: 'yes' })).toEqual({});
    expect(sanitizeSettings({ apiKey: 12345 })).toEqual({});
  });

  it('normalises host lists and drops junk entries', () => {
    const out = sanitizeSettings({ allowlist: ['  EXAMPLE.com ', '', 42, 'ok.example'] });
    expect(out.allowlist).toEqual(['example.com', 'ok.example']);
  });

  it('caps list length and host length', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `h${i}.example`);
    expect(sanitizeSettings({ blocklist: many }).blocklist).toHaveLength(1000);
    expect(sanitizeSettings({ blocklist: ['a'.repeat(300)] }).blocklist).toEqual([]);
  });

  it('only accepts a known sensitivity', () => {
    expect(sanitizeSettings({ sensitivity: SENSITIVITY.STRICT }).sensitivity).toBe('strict');
    // An unknown value would fall back to balanced thresholds while the UI showed something else.
    expect(sanitizeSettings({ sensitivity: 'paranoid' }).sensitivity).toBeUndefined();
  });

  it('accepts every real default unchanged', () => {
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS })).toEqual({ ...DEFAULT_SETTINGS });
  });
});
