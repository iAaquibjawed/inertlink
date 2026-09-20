# Security review

Scope: the shipped extension (`src/` → `dist/`). The landing page in `site/` is static and is
covered separately by the CSP in `render.yaml`.

Last reviewed: 2026-09-20, against the v0.1.0 tree.

---

## Attack surface

| Surface | Exposure |
|---|---|
| Content script | Runs on every granted page. Reads attacker-controlled `href` and anchor text. |
| Service worker | Holds the API key. Performs all network. Receives messages. |
| Popup / options | Extension-origin pages. Can change settings and request permissions. |
| `chrome.storage.sync` | Settings, including the user's API key. |
| `chrome.storage.local` | Verdict cache, remote blocklist. |

**Not exposed:** `externally_connectable` is absent, so no web page can message the extension
directly. `web_accessible_resources` is absent, so no page can fetch extension files or use them
to fingerprint the install. No `content_security_policy` override, so extension pages keep the
restrictive MV3 default. No `eval`, `new Function`, or string-argument timers anywhere in `src/`.

---

## Findings and resolutions

### 1. Privileged messages were accepted from content scripts — **fixed**

`chrome.runtime.onMessage` ignored `sender`, so any caller that could reach the worker could send
any message. The content script is the component most exposed to a hostile page, and it could
send `SET_SETTINGS`.

Impact: `SET_SETTINGS { allowlist: ['attacker.example'] }` silences this extension for that domain
on every tab, permanently, synced to the user's account — disabling the protection with no visible
change. `ENSURE_INJECTED { tabId }` would also allow injection into an arbitrary tab.

Fix: the worker now rejects messages whose `sender.id` is not this extension, and restricts content
scripts to `CHECK_URL` alone. Extension pages are identified by origin
(`chrome-extension://<id>`), **not** by the absence of `sender.tab` — the options page opens in a
tab too, and using that test classified our own UI as untrusted.

### 2. `writeSettings` accepted arbitrary keys and types — **fixed**

Any key could be written to `chrome.storage.sync`, and no value was type-checked. A wrong-typed
`allowlist` (string instead of array) makes the engine's `.some()` call throw; the check registry
catches and swallows that, silently disabling a signal. Junk keys could also exhaust the sync
quota and break settings for the profile.

Fix: `sanitizeSettings()` allowlists the known keys, enforces the type of each, normalises and
caps host lists (1000 entries, 253 chars each — RFC 1035), and rejects an unrecognised
`sensitivity` rather than letting it fall through to a different threshold than the UI displays.
Covered by `tests/settings.test.js`.

### 3. Blocklist feed was fetched without validation — **fixed**

`fetch(settings.blocklistUrl)` accepted any scheme and followed redirects. Over cleartext the list
is modifiable in transit, and a blocklist an attacker can edit is a blocklist they can empty.

Fix: the URL must parse and must be `https:`; redirects are refused (`redirect: 'error'`); entries
must match `/^[a-z0-9.-]+$/` and be at most 253 characters. The feed remains inert unless the user
both enables online checks and supplies a URL.

### 4. Verdict used as an unguarded object index — **fixed**

`GLYPHS[verdict]` resolved up the prototype chain, so a verdict of `constructor` or `__proto__`
would stringify a function into `innerHTML`. Not script execution, but the value arrives via a
message and an object index is not the place to rely on that.

Fix: `Object.hasOwn(GLYPHS, verdict)` gates the lookup and falls back to `unknown`.

### 5. Content script answered messages without checking the sender — **fixed**

`GET_TAB_STATE` returns the per-tab tally, which is a record of what the user hovered. It now
requires `sender.id === chrome.runtime.id`.

---

## Properties verified as already correct

- **No injection sink takes attacker data.** The host, the registrable domain and the reason line
  are written with `textContent`. The only `innerHTML` writes are a static template and a glyph
  selected from a fixed map.
- **Hovering never contacts the link.** No code path fetches, resolves, or prefetches a hovered
  URL; the engine is pure and has no network access.
- **The API key never reaches a page.** It is read in the worker only; the content script neither
  receives nor requests it.
- **Providers receive a host, never a URL.** `safebrowsing.js` additionally strips anything after
  the host as a defensive measure, so a caller mistake cannot leak a path or query string.
- **Least privilege.** No `<all_urls>`; host access is optional, per-origin, and user-granted.
- **Failure is quiet.** Every listener and every check is wrapped; a throw cannot surface on the
  page the user is browsing.

## Residual risks, accepted

- **The API key is stored in `chrome.storage.sync`**, so it travels with the user's Chrome profile.
  This is the user's own key, entered deliberately, and syncing it is the behaviour they expect
  from a browser setting. It is never sent anywhere except the provider it belongs to.
- **Safe Browsing's Lookup API takes the key as a query parameter.** That is the API's design; the
  key can therefore appear in the provider's request logs. The Update API, which avoids this, is
  the documented upgrade path.
- **An allowlisted host is un-flaggable.** That is the point of an allowlist, and the bundled list
  is deliberately short. A user-added entry is the user's decision.
