/**
 * Unwrap email security wrappers and link-protection gateways (pure, offline).
 *
 * Enterprise email systems (Microsoft Defender / Outlook Safe Links, Proofpoint URL Defense,
 * Google Workspace) rewrite links inside emails before delivery. To the user and the browser,
 * the `href` points at the security scanner's hostname with the true target encoded inside.
 *
 * Evaluating the gateway host rather than the destination causes two fatal failure modes:
 *   1. Massive false positives: Every legitimate email link in Outlook/Proofpoint (e.g. Jira,
 *      GitHub, Google Docs) is flagged as DANGER because the gateway link has heavy
 *      percent-encoding, multiple subdomains, and embedded redirect URLs.
 *   2. Blind spot to real threats: If the gateway host is allowlisted, a real phishing link
 *      delivered in an email and wrapped by Safe Links would be branded as "Safe — outlook.com"!
 *
 * The solution: unwrap the gateway link offline to reveal the REAL destination. All 14 detection
 * checks then evaluate the target destination. If the target is Jira, it is Safe. If the target
 * is paypa1.com, it is flagged as Danger — with the badge clearly noting the gateway wrapper.
 *
 * CRITICAL: Only recognized, legitimate security gateways and link shims are unwrapped.
 * Arbitrary open-redirect URLs (e.g. `example.com/redirect?url=https://evil.ru`) are NOT
 * unwrapped, preserving the `encoded-obfuscation` signal on untrusted hosts.
 */

const SAFELINKS_HOST = /(^|\.)safelinks\.protection\.(outlook|office|office365)\.(com|de|us)$/i;
const PROOFPOINT_HOST = /(^|\.)urldefense(\.proofpoint)?\.com$/i;
const GOOGLE_HOST = /(^|\.)google\.[a-z]{2,}(\.[a-z]{2})?$/i;
const SLACK_HOST = /(^|\.)slack-redir\.net$/i;
const FB_HOST = /(^|\.)(l|lm)\.facebook\.com$/i;
const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;

/** Cleanly decode %XX sequences, handling possible double-encoding. */
function cleanDecode(str) {
  if (!str || typeof str !== 'string') return '';
  let cur = str.trim();
  for (let i = 0; i < 3; i++) {
    if (/%[0-9a-f]{2}/i.test(cur)) {
      try {
        const next = decodeURIComponent(cur);
        if (next === cur) break;
        cur = next;
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  return cur;
}

/** Check if a candidate string parses as a valid http or https URL. */
function isValidTarget(target) {
  if (!target || typeof target !== 'string') return false;
  try {
    const u = new URL(target);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Proofpoint v2 decodes custom character substitutions:
 * `-3A__` -> `://`, `-2D` -> `-`, `-2E` -> `.`, `-2F` -> `/`, etc.
 */
function decodeProofpointV2(encoded) {
  if (!encoded) return '';
  let s = encoded
    .replace(/^https?-3A__/i, (m) => (m.toLowerCase().startsWith('https') ? 'https://' : 'http://'))
    .replace(/-2D/g, '-')
    .replace(/-2E/g, '.')
    .replace(/-2F/g, '/')
    .replace(/-3A/g, ':')
    .replace(/-3D/g, '=')
    .replace(/-3F/g, '?')
    .replace(/-40/g, '@')
    .replace(/-2B/g, '+')
    .replace(/-25/g, '%')
    .replace(/-26/g, '&')
    .replace(/-23/g, '#')
    .replace(/-5F/g, '\u0001')
    .replace(/_/g, '/')
    .replace(/\u0001/g, '_');

  return cleanDecode(s);
}

/** Attempt a single unwrap step if the URL matches a known security wrapper. */
function unwrapStep(rawUrl) {
  let urlObj;
  try {
    urlObj = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = urlObj.hostname.toLowerCase();
  const path = urlObj.pathname;

  // 1. Microsoft Defender / Outlook Safe Links
  if (SAFELINKS_HOST.test(host)) {
    const targetParam = urlObj.searchParams.get('url');
    if (targetParam) {
      const target = cleanDecode(targetParam);
      if (isValidTarget(target)) {
        return {
          url: target,
          wrapper: { name: 'Outlook SafeLinks', host },
        };
      }
    }
  }

  // 2. Proofpoint URL Defense (v1, v2, v3)
  if (PROOFPOINT_HOST.test(host)) {
    // v3: /v3/__<url>__;...
    if (path.startsWith('/v3/__')) {
      const fullPath = urlObj.pathname + urlObj.search;
      const m = /\/v3\/__(https?:\/\/[^;!$]+?)__(?:;|\$|!|$)/i.exec(fullPath);
      if (m && m[1]) {
        const target = cleanDecode(m[1]);
        if (isValidTarget(target)) {
          return {
            url: target,
            wrapper: { name: 'Proofpoint URL Defense', host },
          };
        }
      }
    }

    // v2: /v2/url?u=...
    if (path.startsWith('/v2/url')) {
      const u = urlObj.searchParams.get('u');
      if (u) {
        const target = decodeProofpointV2(u);
        if (isValidTarget(target)) {
          return {
            url: target,
            wrapper: { name: 'Proofpoint URL Defense', host },
          };
        }
      }
    }

    // v1: /v1/url?u=...
    if (path.startsWith('/v1/url')) {
      const u = urlObj.searchParams.get('u');
      if (u) {
        const target = cleanDecode(u);
        if (isValidTarget(target)) {
          return {
            url: target,
            wrapper: { name: 'Proofpoint URL Defense', host },
          };
        }
      }
    }
  }

  // 3. Google Redirect / Click Tracking
  if (GOOGLE_HOST.test(host) && path === '/url') {
    const targetParam = urlObj.searchParams.get('url') || urlObj.searchParams.get('q');
    if (targetParam) {
      const target = cleanDecode(targetParam);
      if (isValidTarget(target)) {
        return {
          url: target,
          wrapper: { name: 'Google Redirect', host },
        };
      }
    }
  }

  // 4. Slack Link Redirect
  if (SLACK_HOST.test(host) && path === '/link') {
    const targetParam = urlObj.searchParams.get('url');
    if (targetParam) {
      const target = cleanDecode(targetParam);
      if (isValidTarget(target)) {
        return {
          url: target,
          wrapper: { name: 'Slack Link Redirect', host },
        };
      }
    }
  }

  // 5. Facebook Link Shim
  if (FB_HOST.test(host) && path === '/l.php') {
    const targetParam = urlObj.searchParams.get('u');
    if (targetParam) {
      const target = cleanDecode(targetParam);
      if (isValidTarget(target)) {
        return {
          url: target,
          wrapper: { name: 'Facebook Link Shim', host },
        };
      }
    }
  }

  // 6. LinkedIn Link Redirect
  if (LINKEDIN_HOST.test(host) && path.startsWith('/safety/go')) {
    const targetParam = urlObj.searchParams.get('url');
    if (targetParam) {
      const target = cleanDecode(targetParam);
      if (isValidTarget(target)) {
        return {
          url: target,
          wrapper: { name: 'LinkedIn Safety Redirect', host },
        };
      }
    }
  }

  return null;
}

/**
 * Unwrap a URL if it is wrapped by an email security gateway or link-protection service.
 * Supports up to 3 nested layers of wrappers (e.g. SafeLinks wrapping Proofpoint).
 *
 * @param {string} rawUrl
 * @returns {{ url: string, unwrapped: boolean, wrapper: { name: string, host: string }|null }}
 */
export function unwrapUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { url: rawUrl ?? '', unwrapped: false, wrapper: null };
  }

  let current = rawUrl.trim();
  let firstWrapper = null;
  let depth = 0;

  while (depth < 3) {
    const step = unwrapStep(current);
    if (!step || !isValidTarget(step.url)) break;
    if (!firstWrapper) firstWrapper = step.wrapper;
    current = step.url;
    depth++;
  }

  return {
    url: current,
    unwrapped: depth > 0,
    wrapper: firstWrapper,
  };
}
