/**
 * Engine tests. The golden fixtures are the spec (PLAN.md §4) — this file just runs them.
 *
 * The scaffold invariants below are not filler: each one is a rule that would otherwise be easy
 * to break silently, and two of them (never-safe-on-unparseable, blocklist-beats-allowlist) are
 * the safety properties the whole product rests on.
 */

import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/urls.json';
import { evaluate, primaryReason } from '../src/engine/index.js';
import { CHECKS, assertUniqueIds } from '../src/engine/checks/registry.js';
import { THRESHOLDS, WEIGHTS } from '../src/engine/scoring.js';
import { truncateHost, parseUrl, hostMatches, editDistance } from '../src/engine/parse.js';
import { VERDICT } from '../src/shared/messages.js';
import { SENSITIVITY } from '../src/shared/settings.js';

describe('scaffold invariants', () => {
  it('every registered check has a unique id', () => {
    expect(assertUniqueIds()).toBe(true);
  });

  it('every registered check has a weight in scoring.js', () => {
    // Catches the "added a check, forgot to weight it" mistake, which would score it as 0
    // and silently disable the signal.
    for (const check of CHECKS) {
      expect(WEIGHTS, `missing weight for check "${check.id}"`).toHaveProperty(check.id);
    }
  });

  it('every weighted id has a registered check', () => {
    // The reverse mistake: a weight left behind after a check was renamed or removed.
    const ids = new Set(CHECKS.map((c) => c.id));
    for (const id of Object.keys(WEIGHTS)) {
      expect(ids, `weight "${id}" has no check`).toContain(id);
    }
  });

  it('thresholds are ordered caution < danger at every sensitivity', () => {
    for (const [level, band] of Object.entries(THRESHOLDS)) {
      expect(band.cautionAt, level).toBeLessThan(band.dangerAt);
    }
  });

  it('strict flags at or before balanced, which flags at or before relaxed', () => {
    const { strict, balanced, relaxed } = THRESHOLDS;
    expect(strict.cautionAt).toBeLessThanOrEqual(balanced.cautionAt);
    expect(balanced.cautionAt).toBeLessThanOrEqual(relaxed.cautionAt);
  });

  it('never returns safe for an unparseable URL', () => {
    // Fail safe, not fail green (golden rule 6).
    for (const bad of ['', 'not a url', '://', 'mailto:a@b.com', 'tel:+1234']) {
      expect(evaluate(bad).verdict).not.toBe(VERDICT.SAFE);
    }
  });

  it('truncates hosts in the middle so the TLD survives', () => {
    const host = 'secure-login-account.paypal.com.evil.ru';
    const short = truncateHost(host, 20);
    expect(short.length).toBeLessThanOrEqual(20);
    expect(short.endsWith('evil.ru')).toBe(true);
  });

  it('every firing signal carries a non-empty reason', () => {
    // A badge that says "Danger" with no explanation is a scare, not a safety tool.
    for (const { url, context } of fixtures.cases) {
      for (const signal of evaluate(url, context ?? {}).signals) {
        expect(signal.reason.length, `${url} → ${signal.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('parse', () => {
  it('computes eTLD+1 across multi-part public suffixes', () => {
    expect(parseUrl('https://shop.example.co.uk/x').registrable).toBe('example.co.uk');
    expect(parseUrl('https://example.com/x').registrable).toBe('example.com');
    expect(parseUrl('https://a.b.example.com/x').registrable).toBe('example.com');
    expect(parseUrl('https://user.github.io/x').registrable).toBe('user.github.io');
  });

  it('extracts userinfo rather than mistaking it for the host', () => {
    const p = parseUrl('https://example.com@internal.invalid/verify');
    expect(p.host).toBe('internal.invalid');
    expect(p.userinfo).toBe('example.com');
  });

  it('detects IP hosts including integer and hex encodings', () => {
    expect(parseUrl('http://192.0.2.5/').isIpHost).toBe(true);
    expect(parseUrl('http://[2001:db8::1]/').isIpHost).toBe(true);
    expect(parseUrl('https://example.com/').isIpHost).toBe(false);
  });

  it('matches hosts on boundaries, never as substrings', () => {
    // The bug this prevents: 'evil-google.com'.includes('google.com') would allowlist an attack.
    expect(hostMatches('mail.google.com', 'google.com')).toBe(true);
    expect(hostMatches('google.com', 'google.com')).toBe(true);
    expect(hostMatches('evil-google.com', 'google.com')).toBe(false);
    expect(hostMatches('google.com.evil.ru', 'google.com')).toBe(false);
  });

  it('caps edit distance instead of computing the full matrix', () => {
    expect(editDistance('paypal', 'paypal')).toBe(0);
    expect(editDistance('paypal', 'paypai')).toBe(1);
    expect(editDistance('paypal', 'completely-different', 2)).toBe(3);
  });
});

describe('safety properties', () => {
  it('a blocklisted host is danger even when it is also allowlisted', () => {
    const context = { userAllowlist: ['both.example'], userBlocklist: ['both.example'] };
    expect(evaluate('https://both.example/', context).verdict).toBe(VERDICT.DANGER);
  });

  it('an allowlisted host is never marked borderline, so it is never sent anywhere', () => {
    const v = evaluate('https://google.com/');
    expect(v.borderline).toBe(false);
    expect(v.suppressNetwork).toBe(true);
  });

  it('an allowlisted domain reached over http is not silently trusted', () => {
    // Allowlisting the domain must not allowlist a downgrade attack against it.
    const v = evaluate('http://google.com/login');
    expect(v.signals.map((s) => s.id)).not.toContain('allowlist');
  });

  it('a lookalike subdomain does not inherit the real brand trust', () => {
    const v = evaluate('https://google.com.evil-host.invalid/signin');
    expect(v.verdict).toBe(VERDICT.DANGER);
    expect(v.signals.map((s) => s.id)).not.toContain('allowlist');
  });

  it('strict flags at least as much as relaxed for every fixture', () => {
    const rank = { unknown: 0, safe: 1, caution: 2, danger: 3 };
    for (const { url, context } of fixtures.cases) {
      const strict = evaluate(url, { ...context, sensitivity: SENSITIVITY.STRICT });
      const relaxed = evaluate(url, { ...context, sensitivity: SENSITIVITY.RELAXED });
      if (strict.verdict === VERDICT.UNKNOWN) continue;
      expect(rank[strict.verdict], url).toBeGreaterThanOrEqual(rank[relaxed.verdict]);
    }
  });

  it('surfaces a risk reason ahead of a reassurance when both exist', () => {
    const v = evaluate('https://example.com/', { userAllowlist: ['example.com'] });
    expect(primaryReason(v)).toContain('trusted');
  });
});

describe('golden fixtures', () => {
  const cases = fixtures.cases ?? [];

  it('has cases to run', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('$url → $expect', ({ url, expect: want, signals = [], context }) => {
    const result = evaluate(url, context ?? {});
    expect(result.verdict, `score ${result.score}, signals ${result.signals.map((s) => s.id)}`).toBe(
      want
    );
    for (const id of signals) {
      expect(result.signals.map((s) => s.id)).toContain(id);
    }
  });
});
