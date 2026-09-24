import { describe, expect, it } from 'vitest';
import { evaluate, primaryReason } from '../src/engine/index.js';
import { areSisterDomains } from '../src/engine/parse.js';
import { VERDICT } from '../src/shared/messages.js';

describe('real-world false positive prevention', () => {
  describe('sister domain clusters & rebrands', () => {
    it('recognizes sister domains within major corporate ecosystems', () => {
      expect(areSisterDomains('office.com', 'microsoft.com')).toBe(true);
      expect(areSisterDomains('outlook.com', 'office.com')).toBe(true);
      expect(areSisterDomains('microsoftonline.com', 'azure.com')).toBe(true);
      expect(areSisterDomains('twitter.com', 'x.com')).toBe(true);
      expect(areSisterDomains('atlassian.com', 'atlassian.net')).toBe(true);
      expect(areSisterDomains('jira.com', 'atlassian.net')).toBe(true);
      expect(areSisterDomains('youtube.com', 'youtu.be')).toBe(true);
      expect(areSisterDomains('github.com', 'github.io')).toBe(true);

      // Unrelated domains must not match
      expect(areSisterDomains('google.com', 'microsoft.com')).toBe(false);
      expect(areSisterDomains('paypal.com', 'evil.ru')).toBe(false);
    });

    it('does not flag outlook.office.com or outlook.office365.com as deceptive subdomains', () => {
      const resOffice = evaluate('https://outlook.office.com/mail/');
      expect(resOffice.verdict).toBe(VERDICT.SAFE);
      expect(resOffice.signals.some((s) => s.id === 'deceptive-subdomain')).toBe(false);

      const res365 = evaluate('https://outlook.office365.com/owa/');
      expect(res365.verdict).toBe(VERDICT.SAFE);
      expect(res365.signals.some((s) => s.id === 'deceptive-subdomain')).toBe(false);
    });

    it('does not flag jira.atlassian.net or github.github.io as deceptive subdomains', () => {
      const resJira = evaluate('https://jira.atlassian.net/');
      expect(resJira.signals.some((s) => s.id === 'deceptive-subdomain')).toBe(false);

      const resGh = evaluate('https://github.github.io/pages');
      expect(resGh.signals.some((s) => s.id === 'deceptive-subdomain')).toBe(false);
    });

    it('does not flag anchor text with canonical rebrands or sister domains', () => {
      const resX = evaluate('https://x.com/news', { anchorText: 'https://twitter.com/news' });
      expect(resX.signals.some((s) => s.id === 'text-href-mismatch')).toBe(false);

      const resAtlassian = evaluate('https://norstella.atlassian.net/browse/PROJ-1', {
        anchorText: 'https://atlassian.com/jira',
      });
      expect(resAtlassian.signals.some((s) => s.id === 'text-href-mismatch')).toBe(false);
    });

    it('handles anchor text with surrounding brackets and punctuation gracefully', () => {
      const res = evaluate('https://example.com/about', {
        anchorText: '(https://example.com/about).',
      });
      expect(res.signals.some((s) => s.id === 'text-href-mismatch')).toBe(false);
    });
  });

  describe('SSO & OAuth authentication flows', () => {
    it('does not flag SSO login redirects to sister domains as open redirects', () => {
      const ssoUrl =
        'https://login.microsoftonline.com/common/oauth2/authorize?client_id=123&redirect_uri=https%3A%2F%2Foutlook.office.com%2Fmail';
      const res = evaluate(ssoUrl);
      expect(res.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(false);
    });

    it('does not flag in-domain return_to / next redirect parameters', () => {
      const inDomainUrl =
        'https://example.com/login?return_to=https%3A%2F%2Fexample.com%2Fdashboard%2Foverview';
      const res = evaluate(inDomainUrl);
      expect(res.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(false);
    });

    it('still flags open redirects pointing to untrusted external sites', () => {
      const openRedirect =
        'https://my-legit-site.com/redir?dest=https%3A%2F%2Fexternal-phish.net%2Fsteal';
      const res = evaluate(openRedirect);
      expect(res.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(true);
    });
  });

  describe('code repositories & developer paths', () => {
    it('does not flag 40-character git commit hashes as suspicious base64 blobs', () => {
      const commitUrl =
        'https://github.com/torvalds/linux/commit/e4a1b0235b2e3cf873722955cf4b5f9a65012ef1';
      const res = evaluate(commitUrl);
      expect(res.verdict).toBe(VERDICT.SAFE);
      expect(res.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(false);
    });

    it('does not flag standard UUIDs in path as base64 blobs', () => {
      const uuidUrl =
        'https://api.example.com/v1/orders/123e4567-e89b-12d3-a456-426614174000/status';
      const res = evaluate(uuidUrl);
      expect(res.signals.some((s) => s.id === 'encoded-obfuscation')).toBe(false);
    });
  });

  describe('branded short links vs anonymous cloaking services', () => {
    it('rates branded 1st-party shorteners as Safe with informational weight 0 reason', () => {
      const yt = evaluate('https://youtu.be/dQw4w9WgXcQ');
      expect(yt.verdict).toBe(VERDICT.SAFE);
      expect(primaryReason(yt)).toBe('Official short link for YouTube');

      const amz = evaluate('https://amzn.to/3test');
      expect(amz.verdict).toBe(VERDICT.SAFE);
      expect(primaryReason(amz)).toBe('Official short link for Amazon');

      const wa = evaluate('https://wa.me/1234567890');
      expect(wa.verdict).toBe(VERDICT.SAFE);
      expect(primaryReason(wa)).toBe('Official short link for WhatsApp');
    });

    it('still warns with Caution on anonymous redirect services like bit.ly', () => {
      const bitly = evaluate('https://bit.ly/3xZy91');
      expect(bitly.verdict).toBe(VERDICT.CAUTION);
      expect(bitly.signals.some((s) => s.id === 'url-shortener')).toBe(true);
    });
  });

  describe('private network & overlay addresses (Tailscale/VPNs)', () => {
    it('does not flag Carrier-Grade NAT (100.64.0.0/10) used by Tailscale and VPNs', () => {
      const tailscaleUrl = 'http://100.100.50.25:8080/dashboard';
      const res = evaluate(tailscaleUrl);
      expect(res.signals.some((s) => s.id === 'ip-host')).toBe(false);
    });

    it('does not flag IPv6 Unique Local Addresses as public bare IPs', () => {
      const ipv6Ula = 'http://[fd12:3456:789a:1::1]/status';
      const res = evaluate(ipv6Ula);
      expect(res.signals.some((s) => s.id === 'ip-host')).toBe(false);
    });
  });

  describe('regional ccTLD brand domains', () => {
    it('does not flag international ccTLDs of major brands as typosquats', () => {
      const amzDe = evaluate('https://www.amazon.de/gp/product/B08N5WRWNW');
      expect(amzDe.signals.some((s) => s.id === 'typosquat')).toBe(false);

      const ppUk = evaluate('https://www.paypal.co.uk/signin');
      expect(ppUk.signals.some((s) => s.id === 'typosquat')).toBe(false);

      const gJp = evaluate('https://www.google.co.jp/search?q=tokyo');
      expect(gJp.signals.some((s) => s.id === 'typosquat')).toBe(false);
    });

    it('still aggressively catches true typosquats and homoglyphs', () => {
      const fakeAmz = evaluate('https://arnazon.com/order');
      expect(fakeAmz.signals.some((s) => s.id === 'typosquat')).toBe(true);

      const fakePp = evaluate('https://paypa1.com/verify');
      expect(fakePp.signals.some((s) => s.id === 'typosquat')).toBe(true);

      const fakeMs = evaluate('https://micros0ft.com/login');
      expect(fakeMs.signals.some((s) => s.id === 'typosquat')).toBe(true);
    });
  });

  describe('true phishing attacks remain caught as Danger', () => {
    it('flags deceptive subdomain attacks on evil domains', () => {
      const phish = evaluate('https://outlook.office.com.attacker-verify.ru/login');
      expect(phish.verdict).toBe(VERDICT.DANGER);
      expect(phish.signals.some((s) => s.id === 'deceptive-subdomain')).toBe(true);
    });

    it('flags userinfo trick attacks', () => {
      const userinfo = evaluate('https://paypal.com@evil-destination.com/verify');
      expect(userinfo.verdict).toBe(VERDICT.DANGER);
      expect(userinfo.signals.some((s) => s.id === 'userinfo-trick')).toBe(true);
    });
  });
});
