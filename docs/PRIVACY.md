# InertLink privacy policy

Last updated: 20 September 2026

InertLink is a browser extension that shows whether a link is safe before you click it. This
policy describes exactly what it does with data. It is short because the extension does very
little.

## What it does by default

**Nothing leaves your device.** On a fresh install InertLink makes no network requests at all —
not on install, not when you hover a link, not on a schedule. Every check runs against data
bundled inside the extension.

Hovering a link **never contacts that link**. InertLink reads the address as text. It does not
follow it, resolve it, prefetch it, or expand shortened links, because doing so would send a
request to that site from your computer that you never asked for.

## What is stored, and where

All storage is local to your browser. There is no InertLink server, and no account.

| Data | Where | Why |
|---|---|---|
| Your settings — sensitivity, allow/blocklists, paused sites, optional API key | `chrome.storage.sync` | So your preferences follow your Chrome profile. |
| Cached verdicts, keyed by **hostname** only | `chrome.storage.local` | So the same site is never looked up twice. |
| A count of links seen on the current tab | In that tab's memory | Shown in the popup. Never written to disk; gone when the tab closes. |

No browsing history is recorded. No list of links you hovered is kept anywhere.

## What is sent, only if you turn it on

Online reputation checking is **off by default**. If you enable it and supply your own API key:

- Only the **hostname** is sent — for example `example.com`. Never the path, never the query
  string. Those carry session tokens, password-reset links and search terms, and none of that
  reaches a third party.
- It is sent **only** when the local checks are inconclusive. A link that is clearly fine, or
  clearly bad, is never sent.
- A hostname on your allowlist is **never** sent.
- Results are cached, so a hostname is not sent twice.
- The request is made by the extension's background worker, not by the page you are viewing, and
  carries no cookies or credentials.

The provider is one you choose and authenticate to with your own key. Your use of that provider is
governed by their privacy policy — for Google Safe Browsing, Google's.

If you also configure an optional blocklist feed URL, the extension fetches that list weekly over
HTTPS. It sends no information about you when doing so.

## Site access

InertLink requests no site access when you install it. It runs on a page only when you:

1. click its toolbar icon — which covers that tab for that visit; or
2. grant it a specific site; or
3. choose to let it run on every site.

You can withdraw any of these at any time from the popup, the options page, or
`chrome://extensions`.

## What is never done

- No data is sold or shared with third parties.
- No advertising, analytics, or tracking of any kind is included.
- No data is used for anything other than telling you whether a link is safe.
- No remote code is loaded or executed. Everything that runs ships inside the extension.

## Removing your data

Uninstalling the extension removes everything it stored. You can also clear cached verdicts at any
time from the options page, and remove individual sites from your lists there.

## Source

InertLink is open source: <https://github.com/iAaquibjawed/inertlink>. Every claim above can be
checked against the code, which is the point of publishing it.

## Contact

Mohammad Aaquib Jawed — aaquib@aaquibjawed.com
