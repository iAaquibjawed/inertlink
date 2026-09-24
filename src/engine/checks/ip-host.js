/**
 * `ip-host` — the link points at a raw IP address instead of a domain name.
 *
 * Legitimate services buy domains. An IP in a user-facing link usually means the operator wanted
 * no paper trail, or is serving from a compromised box. It is also how you bypass every
 * domain-reputation system that exists, which is exactly why phishing kits use it.
 *
 * Private/loopback ranges are exempted: 192.168.x / 10.x / 127.x links are developers and routers,
 * not attackers, and flagging them red would train the user to ignore red.
 */

import { WEIGHTS } from '../scoring.js';

const CREDENTIAL_PATH = /(login|signin|sign-in|account|verify|secure|auth|password|wallet|bank)/i;

/** RFC 1918 + RFC 6598 (CGNAT) + loopback + link-local + IPv6 ULA. Local / overlay network, not open internet. */
function isPrivate(host) {
  if (host === 'localhost' || host.startsWith('127.')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;
  const m172 = /^172\.(\d{1,3})\./.exec(host);
  if (m172) {
    const second = Number(m172[1]);
    return second >= 16 && second <= 31;
  }
  // Carrier-Grade NAT (100.64.0.0/10) — used extensively by Tailscale, corporate VPNs, and telco overlays
  const m100 = /^100\.(\d{1,3})\./.exec(host);
  if (m100) {
    const second = Number(m100[1]);
    return second >= 64 && second <= 127;
  }
  const h = host.toLowerCase();
  return (
    h === '[::1]' ||
    h.startsWith('[fe80') ||
    h.startsWith('[fc') ||
    h.startsWith('[fd')
  );
}

export default {
  id: 'ip-host',

  /** @param {import('../parse.js').ParsedUrl} parsed */
  run(parsed) {
    const base = { id: 'ip-host', hit: false, weight: 0, reason: '' };
    if (!parsed.isIpHost) return base;
    if (isPrivate(parsed.host)) return base;

    const credential = CREDENTIAL_PATH.test(parsed.path);
    return {
      ...base,
      hit: true,
      weight: credential ? WEIGHTS['ip-host'] * 1.5 : WEIGHTS['ip-host'],
      reason: credential
        ? 'A sign-in page hosted on a bare IP address, not a real domain'
        : 'Goes to a bare IP address instead of a named website',
    };
  },
};
