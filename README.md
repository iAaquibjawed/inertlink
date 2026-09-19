# LinkVerify

A Chrome (Manifest V3) extension that tells you whether a link is safe **before you click it**.
Hover any link and a small badge appears next to the cursor: green *Safe*, amber *Caution*, red
*Danger* — with the reason.

Local-first by design. Every check runs on your device against data bundled in the extension.
Online reputation lookups are **off by default**, and when you turn them on they send a hostname
only — never the full address, and never for a site on your allowlist.

> **Status: v1 feature-complete (Phases 0–5).** 14 detection heuristics, hover badge, reputation
> layer, popup and options. Deferred by choice: a bundled Inter font, store listing assets, and
> the Safe Browsing *Update* API provider. See `PLAN.md` §5.

## Install (development)

```bash
npm install
npm run build        # required — see docs/DECISIONS.md ADR-0001
```

Then: Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the
**`dist/`** folder.

> Select `dist/`, **not** the repo folder. There is no `manifest.json` at the repo root precisely so
> that picking it fails loudly instead of installing an extension that silently does nothing
> (ADR-0009).

Reload the extension after every build. Content-script changes also need a page refresh.

```bash
npm run watch        # rebuild on save
npm test             # engine unit tests + golden fixtures — must be green before any commit
npm run e2e          # real Chrome, real extension, real hover — see below
```

### `npm run e2e`

`npm test` proves the engine is correct. It cannot prove the extension *runs*, and every real
failure this project has had lived in that gap while the unit tests stayed green. `npm run e2e`
installs `dist/` into a throwaway Chrome profile over the DevTools protocol and asserts the whole
chain: worker starts → content script registered for the granted origin only → injected into a page
→ seven fixture links hovered for real, verdicts read back out of the content script's own tally →
**zero off-origin requests while hovering** → the activeTab activation path. No dependencies.

`HEADED=1 npm run e2e` to watch it happen.

## First run

LinkVerify declares **no static content script** (ADR-0003). On a fresh install it runs on exactly
zero pages.

1. Open any normal `http(s)` page.
2. Click the LinkVerify toolbar icon.

That's it — **clicking the icon activates it on that tab**, with no permission prompt, and badges
work immediately.

There are three levels of access, and you pick how far to go:

| Level | How | Lasts |
|---|---|---|
| **Click the icon** (default) | Click the toolbar icon | That tab, that visit. `activeTab` — one click, expires on its own |
| **This site** | Popup → **Always run on \<host\>** | That site, until you remove it |
| **Every site** | Popup → **Or run on every site automatically**, or Options → **Where LinkVerify runs** | Everywhere, until you turn it off |

If you don't want to click the icon on each new site, use **every site**. That is the one prompt
that makes LinkVerify behave like an always-on tool. It is opt-in, never requested at install, and
revocable from the same two places (ADR-0010, ADR-0012).

## Manual smoke test

```bash
npm run smoke        # serves the page at http://localhost:8787/phishing-sandbox.html
```

Open that URL, grant it in the popup, and hover each link; the badge should match the expectation
printed beneath it. Nothing on that page is live malware — every "dangerous" link uses RFC 2606
reserved names or RFC 5737 documentation IPs and resolves nowhere.

**Open it over http, not `file://`.** A file URL has an opaque origin that cannot be written as a
match pattern, and the extension only declares http/https under `optional_host_permissions` — so
there is nothing the popup can request. The popup says so rather than showing a button that cannot
work.

What to verify beyond the verdicts:
- The badge never covers the link and never blocks a click — try clicking through it.
- It flips left at the right edge of the viewport instead of overflowing.
- It disappears on mouse-out, on scroll, and on <kbd>Esc</kbd>.
- DevTools → Network shows **zero** requests while hovering, in the default configuration.

## How a verdict is reached

```
hover → 250ms dwell → parse the href string (never fetched)
      → 14 independent checks, each returning { id, hit, weight, reason }
      → sum the weights → threshold by sensitivity → safe / caution / danger
      → borderline AND online checks on AND not allowlisted?
           → service worker → cache? → provider (hostname only) → worst-wins merge
```

Every check lives in its own file under `src/engine/checks/` and is registered in one array.
Adding a signal is one file, one line, and one fixture — never a branch in a growing conditional.

Thresholds and per-check weights live in exactly one place, `src/engine/scoring.js`, and shift with
the user's sensitivity setting. `tests/fixtures/urls.json` is the spec they are calibrated against.

## Layout

```
src/engine/    pure detection logic — no DOM, no chrome.*, no fetch. The only tested code.
src/content/   hover listener + shadow-DOM badge. Runs on user pages, so it ships zero dependencies.
src/worker/    service worker: reputation providers, verdict cache, all network, the API key.
src/shared/    message contract, settings, design tokens.
src/ui/        React-only helpers for the two bundled pages.
src/popup/     toolbar popup (React + Framer Motion).
src/options/   settings page (React + Framer Motion).
tests/         vitest + golden URL fixtures (the spec) + a manual smoke page.
```

## Docs

| File | What's in it |
|------|--------------|
| `CLAUDE.md` | Operating manual for AI sessions. Read first. |
| `PLAN.md` | Product spec, detection design, phased roadmap. |
| `docs/ARCHITECTURE.md` | Trust boundaries, hover flow, storage, failure behavior. |
| `docs/DECISIONS.md` | ADR log — what was chosen over what, and why. |
| `design-system/linkverify/MASTER.md` | Colors, type, motion, component specs. |

## Privacy

- Local heuristics run with **zero network**. A default install makes no requests at all.
- Online checks are opt-in, **hostname-only** (never the path or query string), cached per host so
  a host is never sent twice, and skipped entirely for allowlisted domains.
- Hovering a link **never** contacts that link's destination. We inspect the URL string, not the
  page behind it — resolving a shortener would be a request to the attacker's server, from your IP,
  triggered by a mouse movement.
- Per-tab counts in the popup live in that tab's memory and die with it. Nothing about what you
  hovered is written to disk.
- No remote code. Everything ships in the package; nothing is fetched at runtime, and the build
  fails if a CDN URL appears anywhere in `dist/`.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| `storage` | Settings (`sync`) and the verdict cache (`local`). |
| `scripting` | Register the content script per granted origin, and inject into a tab you just granted. |
| `alarms` | Weekly blocklist refresh. Inert unless you enable online checks *and* set a feed URL. |
| `activeTab` | The popup needs the current tab's URL to name the site and request that origin. Narrower than `tabs`, which would expose every tab permanently. |
| `optional_host_permissions` | Page access, granted by you, one site at a time. Not requested at install. |

Full reasoning in `docs/DECISIONS.md` (ADR-0003, ADR-0008).
