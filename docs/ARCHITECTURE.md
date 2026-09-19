# Architecture

Expands PLAN.md §3. Read `CLAUDE.md` first for the rules this design exists to satisfy.

## Trust boundaries

Three contexts, with deliberately different privileges:

| Context | Runs where | May touch | May NOT touch |
|---------|-----------|-----------|---------------|
| `src/engine/` | Both content script and worker | Nothing but its arguments | DOM, `chrome.*`, `fetch` |
| `src/content/` | The user's web pages | DOM (its own shadow root), `chrome.runtime` messaging | Network, API keys, `chrome.storage` directly |
| `src/worker/` | Extension background | Network, `chrome.storage`, API keys | The page, the DOM |

The rule behind the table: **the page never learns anything the extension knows.** The API key and
every outbound request live in the worker, so a compromised or hostile page can't read them.

## Flow of one hover

```
user hovers <a>
  → content/hover.js  (delegated listener, ~250ms dwell debounce)
  → engine.evaluate(href, { anchorText, pageHost, sensitivity })   ← pure, offline, instant
  → content/badge.js renders the verdict                           ← done for most links
       │
       └─ only if verdict.borderline && !allowlisted && settings.onlineChecks
            → chrome.runtime.sendMessage(CHECK_URL)
            → worker: cache lookup (host key) — hit? respond, no network
                      miss? provider.check(host) → cache write → respond
            → content/badge.js updates in place
```

Three gates stand between a hover and a packet: the verdict must be borderline, the host must not
be allowlisted, and the user must have turned online checks on (they are off by default). Anything
that clears all three is cached by host, so it happens at most once.

## What never happens on hover

- **No request to the link's destination.** We read the URL string. We never resolve it, preview
  it, or `fetch` it (golden rule 3).
- **No full URL leaves the device.** Providers receive a hostname. Query strings carry session
  tokens, password-reset links, and search terms; none of that is ours to send (golden rule 2).
- **No layout work on the host page.** The badge is `position: fixed` inside its own shadow root
  and animates transform/opacity only, so it never triggers reflow in the page's tree.

## Message contract

Normative copy lives in `src/shared/messages.js`. PLAN.md §3 and that file must agree; if they
drift, the file wins and PLAN.md gets fixed in the same commit.

```js
// content → worker
{ type: 'CHECK_URL', host, url, localScore }
// worker → content
{ type: 'CHECK_RESULT', host, verdict, source, reasons }
// popup / options → worker
{ type: 'GET_SETTINGS' } | { type: 'SET_SETTINGS', patch } | { type: 'CLEAR_CACHE' }
```

`url` is passed for local re-evaluation only and must not be forwarded to any provider.

## Storage

| Store | Holds | Why there |
|-------|-------|-----------|
| `chrome.storage.sync` | Settings: enabled, sensitivity, allow/blocklist, paused hosts, API key | Follows the user's profile across devices |
| `chrome.storage.local` | Verdict cache (`lv:verdict:<host>`), bundled blocklist | Device-sized, not worth syncing, and sync has a hard quota |

MV3 service workers sleep. Nothing lives in module scope across messages — every handler reads what
it needs from storage (PLAN.md §6).

## Build

`src/` is the source of truth; **`dist/` is what you load unpacked** (ADR-0001).

- `popup/` and `options/` are bundled by esbuild (React + Framer Motion, inlined).
- `engine/`, `content/`, `worker/`, `shared/` are copied verbatim as ES modules — the code that
  runs on user pages stays readable and auditable against the repo, byte for byte.
- `src/ui/` is React-only and is never copied; it exists solely inside the two bundles.

## Failure behavior

Every layer degrades toward *less confidence*, never toward *more safety claimed*:

- A check throws → that signal is dropped, the rest still score.
- `parseUrl` fails → `unknown`, never `safe`.
- The worker is asleep, errors, or times out → keep the local verdict.
- The provider is down → keep the local verdict, don't cache the failure as a verdict.
