import { describe, expect, it } from 'vitest';
import { unwrapUrl } from '../src/engine/unwrap.js';
import { parseUrl } from '../src/engine/parse.js';
import { evaluate, primaryReason } from '../src/engine/index.js';
import { VERDICT } from '../src/shared/messages.js';

describe('email security wrapper unwrapping', () => {
  const userSafeLink =
    'https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnorstella.atlassian.net%2Fbrowse%2FCITEC-3608%3FatlOrigin%3DeyJpIjoiMmVjYmZlODQ2MGY2NDYzNWI5YTJlYmM0NmVhZTNiMDQiLCJwIjoiaiJ9&data=05%7C02%7Cmdaaquib.jawed%40norstella.com%7C4dc8ae634c724ce67d5608df1a0b80cb%7Cfa62df0185e942728434d8b84d55a66d%7C0%7C0%7C639258309027802310%7CUnknown%7CTWFpbGZsb3d8eyJFbXB0eU1hcGkiOnRydWUsIlYiOiIwLjAuMDAwMCIsIlAiOiJXaW4zMiIsIkFOIjoiTWFpbCIsIldUIjoyfQ%3D%3D%7C80000%7C%7C%7C&sdata=UWu3haKF7PcFnDwiTL3zoMZsaoEjxYBTz%2BBz%2BeqOfho%3D&reserved=0';

  it('unwraps Microsoft Outlook SafeLinks to the genuine target destination', () => {
    const res = unwrapUrl(userSafeLink);
    expect(res.unwrapped).toBe(true);
    expect(res.wrapper?.name).toBe('Outlook SafeLinks');
    expect(res.url).toBe(
      'https://norstella.atlassian.net/browse/CITEC-3608?atlOrigin=eyJpIjoiMmVjYmZlODQ2MGY2NDYzNWI5YTJlYmM0NmVhZTNiMDQiLCJwIjoiaiJ9'
    );
  });

  it('evaluates legitimate unwrapped Outlook SafeLink as safe and verifies owner', () => {
    const result = evaluate(userSafeLink, {
      anchorText: 'norstella.atlassian.net',
    });

    expect(result.verdict).toBe(VERDICT.SAFE);
    expect(result.parsed?.host).toBe('norstella.atlassian.net');
    expect(result.parsed?.registrable).toBe('atlassian.net');
    expect(result.wrapper?.name).toBe('Outlook SafeLinks');
    expect(primaryReason(result)).toContain('Outlook SafeLinks');
    expect(result.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(false);
    expect(result.signals.some((s) => s.id === 'text-href-mismatch')).toBe(false);
  });

  it('flags malicious phishing link wrapped in Outlook SafeLinks as Danger', () => {
    const phishSafeLink =
      'https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Fpaypa1.com%2Fsignin%3Faccount%3Dverify&data=05%7Ctest';
    const result = evaluate(phishSafeLink);

    expect(result.verdict).toBe(VERDICT.DANGER);
    expect(result.parsed?.host).toBe('paypa1.com');
    expect(result.signals.some((s) => s.id === 'typosquat')).toBe(true);
    expect(primaryReason(result)).toContain('paypal.com');
    expect(primaryReason(result)).toContain('Outlook SafeLinks');
  });

  it('unwraps Proofpoint URL Defense v1 and v2', () => {
    const ppV1 = 'https://urldefense.proofpoint.com/v1/url?u=https://example.com/docs&k=test';
    const res1 = unwrapUrl(ppV1);
    expect(res1.unwrapped).toBe(true);
    expect(res1.wrapper?.name).toBe('Proofpoint URL Defense');
    expect(res1.url).toBe('https://example.com/docs');

    const ppV2 =
      'https://urldefense.proofpoint.com/v2/url?u=https-3A__example.com_my-2Dreport_view-3Fid-3D123&d=test';
    const res2 = unwrapUrl(ppV2);
    expect(res2.unwrapped).toBe(true);
    expect(res2.url).toBe('https://example.com/my-report/view?id=123');
  });

  it('unwraps Proofpoint URL Defense v3', () => {
    const ppV3 =
      'https://urldefense.com/v3/__https://example.com/project/item__;!!M9LbjjnbBg!token$';
    const res = unwrapUrl(ppV3);
    expect(res.unwrapped).toBe(true);
    expect(res.wrapper?.name).toBe('Proofpoint URL Defense');
    expect(res.url).toBe('https://example.com/project/item');
  });

  it('unwraps Google redirect links', () => {
    const gUrl = 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fguide&sa=D';
    const res = unwrapUrl(gUrl);
    expect(res.unwrapped).toBe(true);
    expect(res.wrapper?.name).toBe('Google Redirect');
    expect(res.url).toBe('https://example.com/guide');
  });

  it('unwraps Slack and Facebook link redirects', () => {
    const slack = 'https://slack-redir.net/link?url=https%3A%2F%2Fgithub.com%2Frepo';
    expect(unwrapUrl(slack).url).toBe('https://github.com/repo');

    const fb = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Farticle';
    expect(unwrapUrl(fb).url).toBe('https://example.com/article');
  });

  it('does NOT unwrap arbitrary open redirects on untrusted domains', () => {
    const untrustedRedirect = 'https://evil-redirector.com/forward?url=https://legitimate.com';
    const res = unwrapUrl(untrustedRedirect);
    expect(res.unwrapped).toBe(false);
    expect(res.wrapper).toBeNull();
    expect(res.url).toBe(untrustedRedirect);

    // evaluate must still flag this as suspicious encoded-obfuscation
    const evalRes = evaluate(untrustedRedirect);
    expect(evalRes.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(true);
  });

  it('fails gracefully on malformed wrapper parameters', () => {
    const badSafeLink = 'https://nam04.safelinks.protection.outlook.com/?url=not-a-url';
    const res = unwrapUrl(badSafeLink);
    expect(res.unwrapped).toBe(false);
  });
});
