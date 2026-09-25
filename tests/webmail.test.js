import { describe, expect, it } from 'vitest';
import { evaluate, effectiveSensitivity } from '../src/engine/index.js';

describe('webmail is judged one step stricter (ADR-0019)', () => {
  it('tightens by one step inside webmail, and only there', () => {
    expect(effectiveSensitivity('balanced', 'mail.google.com')).toBe('strict');
    expect(effectiveSensitivity('relaxed', 'outlook.office.com')).toBe('balanced');
    expect(effectiveSensitivity('strict', 'outlook.live.com')).toBe('strict');
    expect(effectiveSensitivity('balanced', 'news.example.com')).toBe('balanced');
    // Suffix matching, never substring: this is not Gmail.
    expect(effectiveSensitivity('balanced', 'mail.google.com.evil.invalid')).toBe('balanced');
  });

  it('turns a weak signal into caution when the link arrived by email', () => {
    const url = 'https://tokenim-cdn-demo.xyz/';
    const onWeb = evaluate(url, { pageHost: 'news.example.com' });
    const inMail = evaluate(url, { pageHost: 'mail.google.com' });
    expect(onWeb.score).toBe(inMail.score); // same evidence…
    expect(['caution', 'danger']).toContain(inMail.verdict); // …stricter reading
  });
});
