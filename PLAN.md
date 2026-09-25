# InertLink — Project Plan

A Chrome (Manifest V3) extension that flags whether a link is safe **on hover**, before the user
clicks. Hybrid detection: instant local heuristics + a reputation API for borderline cases.

This document is the roadmap and architecture reference. `CLAUDE.md` holds the working rules for AI
sessions. Read that first if you're about to write code.

---

## 1. Product spec

**The experience:** User moves the mouse over a link. After a short dwell (~250 ms), a small badge
appears next to the cursor: green "Safe", yellow "Caution — looks like a shortened link", red
"Danger — this domain imitates paypal.com". The badge never covers the link, never intercepts the
click, and vanishes when the mouse leaves. Clicking the badge (or a keyboard shortcut) opens a
details panel: every signal that fired and why.

**Verdict levels:** `safe` | `caution` | `danger` | `unknown` (checked but inconclusive) |
`checking` (API in flight).

**States the user controls (popup/options):** master on/off, per-site pause, sensitivity
(strict/balanced/relaxed — shifts the score thresholds), personal allowlist & blocklist, whether to
use the online reputation API at all, and their API key.

---

## 2. Detection engine (the core)

Two layers. Layer 1 always runs and is enough for most bad links. Layer 2 confirms the ambiguous
ones without leaking browsing data.

### Layer 1 — Local heuristics (offline, instant, private)

Parse the URL once, then run a **registry of independent checks**, each returning
`{ id, hit, weight, reason }`. Sum the weights of hits → risk score → threshold → verdict. Keeping
checks independent is deliberate: adding a signal is one new file + one test, never editing a giant
conditional.

Planned checks (each becomes `src/engine/checks/<id>.js`):

| id | What it catches | Example |
|---|---|---|
| `non-https` | Insecure or dangerous scheme | `http://…`, `javascript:`, `data:` links |
| `ip-host` | Raw IP instead of a domain | `http://192.0.2.5/login` |
| `userinfo-trick` | `@` hides the real host | `http://apple.com@evil.ru` |
| `punycode-idn` | IDN/punycode homograph | `xn--pypal-4ve.com`, mixed-script hosts |
| `typosquat` | Edit-distance to a known brand | `paypa1.com`, `g00gle.com`, `micros0ft-support.com` |
| `deceptive-subdomain` | Brand as subdomain of another host | `paypal.com.secure-login.ru` |
| `brand-impersonation` | Brand name inside a domain it doesn't own | `snapchat-web.vercel.app`, `roblox.com.do` |
| `free-hosting` | Anonymous free host / dynamic DNS / IPFS | `*.pages.dev`, `*.duckdns.org` |
| `credential-lure` | Sign-in words in the registered name | `your-account-login.com` |
| `url-model` | Learned: the URL is *shaped* like phishing (ADR-0019) | unreported phish no rule names |
| `suspicious-tld` | High-abuse TLDs (weighted, tunable) | `.zip`, `.mov`, `.tk`, `.top` |
| `url-shortener` | Destination hidden behind a shortener | `bit.ly/…`, `t.co/…` → "unknown target" |
| `excessive-subdomains` | Unusually deep host | `a.b.c.d.e.example.com` |
| `text-href-mismatch` | Anchor text ≠ real destination | text "paypal.com", href elsewhere |
| `encoded-obfuscation` | Heavy %-encoding / hex / long random host | credential-phishing links |
| `nonstandard-port` | Login pages on odd ports | `example.com:8081/login` |
| `local-blocklist` | Bundled + user blocklist hit | curated phishing hosts |
| `allowlist` | Known-safe / user-trusted → short-circuit | `google.com`, user entries |

Reference data lives in `src/engine/data/`: `top-brands.json` (for typosquat distance),
`safe-tlds`/`risky-tlds`, `shorteners.json`, `known-safe.json`, and a bundled `blocklist.json`
(hosts, refreshed by the worker on an alarm).

Thresholds live in one place (`src/engine/scoring.js`) and shift with the sensitivity setting.

### Layer 2 — Reputation API (network, gated, cached)

Only invoked when Layer 1 says "borderline" (score in a middle band) **and** the host isn't
allowlisted/known-safe. Runs in the **service worker**, never the content script, so the API key and
network stay off the page.

- **Default provider:** Google Safe Browsing. Prefer the **Update API** (downloads hashed threat
  lists, matches locally — the URL never leaves the device) for privacy; **Lookup API** is an
  acceptable MVP shortcut behind a user-supplied key.
- **Provider interface** (`src/worker/providers/`): each provider implements
  `check(host) → { verdict, source, ttl }`, so `urlscan.io` / PhishTank can be added later without
  touching callers.
- **Caching:** `host → { verdict, source, expiresAt }` in `chrome.storage.local`. Check cache
  before any network call. TTLs by verdict (safe longer, danger shorter).
- **Debounce & dedupe:** only the link under a sustained hover triggers a check; in-flight requests
  per host are shared.

**Result:** for the common cases (obvious typosquat, IP login page, allowlisted bank) we answer
instantly and offline. We spend a network call only on the genuinely ambiguous minority.

---

## 3. Architecture (MV3)

```
        ┌────────────────────────── web page ──────────────────────────┐
        │  content script (src/content/)                                │
        │   • delegated mouseover/out listener → nearest <a>            │
        │   • runs Layer-1 engine locally (import of src/engine)        │
        │   • renders badge (shadow DOM, pointer-events:none)           │
        │   • if borderline → message worker for Layer-2                │
        └───────────────┬───────────────────────────────────────────────┘
                        │  chrome.runtime message (typed contract)
        ┌───────────────▼─────────────── service worker (src/worker/) ──┐
        │   • reputation providers (Safe Browsing, …)                   │
        │   • verdict cache (chrome.storage.local)                      │
        │   • blocklist refresh on chrome.alarms                        │
        │   • holds API key; does all network                          │
        └───────────────────────────────────────────────────────────────┘
   popup (src/popup/)  ·  options (src/options/)  →  settings in chrome.storage.sync
```

### Message contract (content ⇄ worker)

Keep this the single source of truth; don't invent ad-hoc messages.

```js
// content → worker
{ type: 'CHECK_URL', host, url, localScore }
// worker → content (response)
{ type: 'CHECK_RESULT', host, verdict, source, reasons }
// popup/options → worker
{ type: 'GET_SETTINGS' } | { type: 'SET_SETTINGS', patch } | { type: 'CLEAR_CACHE' }
// popup → worker: re-register + inject into the tab the user just granted, so the page they are
// already looking at starts working without a reload
{ type: 'ENSURE_INJECTED', tabId }
// popup → content script (chrome.tabs.sendMessage): this tab's live state
{ type: 'GET_TAB_STATE' }
//   → { active, paused, host, counts: { safe, caution, danger, unknown } }
```

`GET_SETTINGS` answers with the settings object plus `cacheSize`, so the options page can say what
"clear cached verdicts" will actually remove.

Everything goes through `sendSafe()` in `shared/messages.js`, which resolves to `null` instead of
throwing. A sleeping worker, a tab with no content script, and a page mid-navigation are all
normal, and an unhandled rejection in a content script is a console error on someone else's site
(golden rule 6).

---

## 4. File tree (what we scaffold, and why each helps AI build well)

```
inertlink/
├─ CLAUDE.md                 # AI operating manual — read first (already written)
├─ PLAN.md                   # this file
├─ README.md                 # human-facing: what it is, how to install
├─ docs/
│  ├─ ARCHITECTURE.md        # data flow + message contract, expanded
│  └─ DECISIONS.md           # short log of "we chose X over Y because…" (ADRs)
├─ package.json              # dev deps only (vitest); test scripts
├─ src/
│  ├─ manifest.json         # MV3 manifest. In src/, NOT the root — a root manifest is
│  │                        # loadable by "Load unpacked" and then 404s every path (ADR-0009).
│  ├─ engine/                # PURE, no chrome.*, no DOM, no fetch — 100% testable
│  │  ├─ index.js            # evaluate(url, context) → verdict
│  │  ├─ scoring.js          # weights, thresholds, sensitivity
│  │  ├─ parse.js            # safe URL parsing helpers
│  │  ├─ checks/             # one file per heuristic (see §2 table)
│  │  └─ data/               # top-brands, tlds, shorteners, known-safe, blocklist
│  ├─ content/
│  │  ├─ hover.js            # listeners, debounce, orchestration
│  │  └─ badge.js            # shadow-DOM tooltip render/teardown
│  ├─ worker/
│  │  ├─ service-worker.js   # message router, alarms
│  │  ├─ cache.js            # verdict cache over chrome.storage.local
│  │  └─ providers/          # safebrowsing.js, (later) urlscan.js
│  ├─ shared/
│  │  ├─ messages.js         # message-type constants (the contract)
│  │  └─ settings.js         # read/write chrome.storage.sync, defaults
│  ├─ popup/                 # popup.html/.js/.css — toggle, stats, lists
│  └─ options/               # options.html/.js/.css — full settings
├─ tests/
│  ├─ fixtures/urls.json     # GOLDEN: url → expected verdict + expected signals
│  ├─ engine.test.js         # runs every check against fixtures
│  └─ manual/phishing-sandbox.html  # local page of safe + crafted-bad links
└─ assets/icons/             # 16/32/48/128 px extension icons
```

**Why this structure is optimized for AI-assisted development** (this is the heart of your
question — the files/things I'd create *first* so Claude Code works fast and correctly):

1. **`CLAUDE.md` first.** The single highest-leverage file. It pins every decision (MV3, no remote
   code, privacy rules, pure engine, how to test) so the AI doesn't re-litigate them each session or
   drift into an insecure pattern. Written already.
2. **Golden fixtures (`tests/fixtures/urls.json`) second.** A concrete list of URLs with their
   expected verdicts *is the spec*. Give the AI a target it can run against and it can implement
   checks, self-verify, and know when it's done — instead of guessing. This turns "build a phishing
   detector" into "make these tests pass."
3. **A pure, registry-based engine.** Because checks are isolated pure functions with no `chrome.*`
   or DOM, the AI can add/modify one heuristic in a tight test loop without loading the extension in
   a browser. Small blast radius = fast, safe iteration.
4. **A written message contract + `shared/messages.js`.** Ambiguous component boundaries are where
   AI-written code goes wrong. Pinning the content⇄worker messages up front prevents mismatched
   shapes across sessions.
5. **`docs/DECISIONS.md` (ADR log).** Every non-obvious choice gets two lines. Future sessions read
   *why*, so they extend the design instead of reinventing or reversing it.
6. **A manual smoke page.** `tests/manual/phishing-sandbox.html` gives a repeatable, safe
   (no live malware) way to eyeball the badge — the one part unit tests can't cover.

Order of creation: `CLAUDE.md` → `PLAN.md` → `manifest.json` + `package.json` → golden fixtures →
engine (`parse` → `scoring` → checks) → content script + badge → worker + Safe Browsing provider →
popup/options → icons → docs polish.

---

## 5. Phased roadmap

**Phase 0 — Scaffold & guardrails.** ✅ **Done.** Repo files, `manifest.json`, `package.json`,
vitest wired up, empty golden fixtures, ADR log. Extension loads unpacked and does nothing yet.

**Phase 1 — Local engine (MVP brain).** ✅ **Done.** `parse`, `scoring`, and all 14 Layer-1 checks,
calibrated against the golden fixtures. 35 fixture cases + 20 invariant/property tests, all green.

**Phase 2 — Hover UI.** ✅ **Done.** Delegated listener, 250ms dwell, per-href memo, shadow-DOM
badge, rAF-throttled repositioning, dismissal on scroll/blur/Escape. Registered dynamically per
granted origin (ADR-0003); bundled as a classic IIFE (ADR-0007).

**Phase 3 — Reputation layer.** ✅ **Done.** Verdict cache with per-verdict TTLs and an eviction
cap, Safe Browsing Lookup provider behind a user key, in-flight dedupe per host, and the
four-stage gate (opt-in → provider+key → allowlist → cache) before any request. Verdicts merge
worst-wins, so a "clean" API answer never erases a local signal.

**Phase 4 — Controls.** ✅ **Done.** Popup: per-site grant/revoke, master toggle, per-site pause,
live per-tab counts read from the content script. Options: sensitivity, allow/blocklist/paused
lists, API key, feed URL, cache size + clear. All persisted to `chrome.storage.sync` and
broadcast live via `onChanged`.

**Phase 5 — Polish & ship.** ✅ **Done for v1.** Blocklist auto-refresh alarm (inert by default),
build-time guards for golden rule 1 and ADR-0002, performance pass (dwell + memo + rAF), a11y pass
(`role="status"`, `aria-live`, Escape dismissal, reduced-motion, AA contrast in both themes).
**Remaining, deliberately deferred:** bundling Inter under `assets/fonts/` (ADR-0004), store
listing assets and screenshots, and the Safe Browsing **Update API** provider (local hash-prefix
matching, so the host never leaves the device) — the interface for it already exists.

---

## 6. Key risks & how the design handles them

- **Privacy backlash** (sending browsing to a third party): local-first, API only on borderline
  hosts, caching, Safe Browsing Update API where the URL never leaves the device, and a hard user
  toggle to disable online checks entirely.
- **Performance** (hover fires constantly): event delegation, dwell debounce, memoized parse,
  verdict cache. The engine is pure and cheap.
- **False positives** (crying wolf kills trust): tunable sensitivity, generous known-safe allowlist,
  "Caution" as a distinct softer level, and always showing *why* so the user can judge.
- **Breaking host pages:** badge in shadow DOM with `pointer-events:none`; every hook wrapped so a
  throw can never break the page; fail back to local verdict if the API errors.
- **MV3 service-worker lifecycle** (workers sleep): keep state in `chrome.storage`, not memory;
  don't assume the worker is alive between messages.

## 7. Backlog (post-v1 ideas — park, don't build)

Credential-field/form warnings, right-click "check this link" menu, click-time interstitial for red
links, community-reported blocklist, ML classifier, enterprise policy sync, Safari port, a hosted
backend for shared threat intel.
