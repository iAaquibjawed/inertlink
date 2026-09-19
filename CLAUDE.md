# CLAUDE.md — InertLink

> This file is the operating manual for any AI (Claude Code, etc.) working in this repo.
> Read it fully before writing code. It is deliberately opinionated so you don't have to
> re-derive decisions each session. If something here is wrong, propose an edit — don't quietly
> deviate.

## 1. What we're building

**InertLink** is a Chrome browser extension (Manifest V3) that tells the user whether a link is
safe **before they click it**. When the mouse hovers over any `<a>` element on a page, a small
badge/tooltip appears near the cursor with a verdict:

- 🟢 **Safe** — no risk signals.
- 🟡 **Caution** — one or more suspicious signals; explain why.
- 🔴 **Danger** — high-confidence phishing / malware / deceptive link.

The verdict comes from a **hybrid engine**: fast local heuristics run on every hover (offline,
private), and a reputation API confirms borderline cases (background, cached).

Primary target: **Chrome/Edge (Chromium, MV3)**. Keep code portable to Firefox (WebExtensions)
where cheap, but don't block on it.

## 2. Golden rules (do not violate)

1. **No remote code.** MV3 forbids it and so do we. No `eval`, no injecting remote scripts, no
   loading JS from a CDN at runtime. Everything ships in the package.
2. **Privacy first.** A hovered link is user browsing data. Local heuristics must run with **zero
   network**. The reputation API is called **only** when (a) local score is borderline, (b) the
   domain isn't allowlisted/known-safe, and (c) after a hover-dwell debounce. Cache verdicts so we
   never re-send the same host. Never send full URLs with query strings/tokens to a third party —
   send the host (and hashed prefixes where the API supports it, e.g. Safe Browsing Update API).
3. **Never auto-navigate or auto-fetch the target.** Hover must not trigger a request to the link's
   destination. We inspect the URL string, not the page behind it.
4. **Least privilege in `manifest.json`.** Request the minimum permissions. Prefer
   `optional_host_permissions` and let the user grant sites. No `<all_urls>` unless justified in a
   comment.
5. **The engine is pure and testable.** All detection logic lives in framework-free pure functions
   (`src/engine/`) that take a URL/context and return a verdict object. No DOM, no `chrome.*`, no
   `fetch` inside the engine. This is what lets us test it and reuse it in content script + worker.
6. **Fail safe, fail quiet.** If the API is down or a check throws, fall back to the local verdict
   and never crash the page. The extension must never break the sites the user is browsing.
7. **Accessibility & UX.** The badge must not steal focus, block clicks, or cover the link target.
   It's `pointer-events: none`, high-contrast, and disappears on mouse-out. Respect
   `prefers-reduced-motion` and `prefers-color-scheme`.

## 3. Tech decisions (already made)

- **Manifest:** MV3, `service_worker` background (not persistent). **No static `content_scripts`** —
  host access is optional and the content script is registered dynamically after the user grants a
  site (ADR-0003).
- **Language/build:** **Split** (ADR-0001, supersedes the original "no build step"; ADR-0007
  supersedes "copied verbatim"):
  - `engine/`, `content/`, `worker/`, `shared/` — **plain vanilla JS + ES modules, zero
    dependencies**. This is non-negotiable for `content/`: it runs on every page the user grants
    (ADR-0002), and the build **asserts** it — React/Framer Motion in `content.js`, or a bundle
    over 80kb, fails `npm run build`.
  - `content/` is bundled to one **classic IIFE, unminified** (`dist/content/content.js`), because
    content scripts cannot be ES modules. Unminified so it can be read against `src/` (ADR-0007).
  - `worker/` is bundled to ESM. `shared/tokens.css` is copied verbatim for the two HTML pages.
  - `popup/`, `options/` — **React 19 + Framer Motion**, bundled and minified by esbuild. These are
    extension pages, loaded on demand, and never touch a user's page.
  - The unpacked target is **`dist/`**, not `src/`. `npm run build` is required.
  - Everything is inlined at build time, so golden rule 1 still holds — `verifyNoRemoteRefs()`
    fails the build if a CDN URL appears in any shipped HTML, CSS, or JS. Any new runtime
    dependency needs a new ADR.
- **Design system:** `design-system/inertlink/MASTER.md` is the source of truth for color, type,
  spacing, and motion. Tokens are mirrored in `src/shared/tokens.css`. Change MASTER.md first.
- **Detection:** Hybrid — local heuristics (Layer 1) + reputation API (Layer 2). Default API is
  **Google Safe Browsing** (Update API preferred for privacy; Lookup API acceptable for MVP behind
  a user-supplied key). `urlscan.io` / PhishTank are optional secondary providers behind an
  interface.
- **Storage:** `chrome.storage.sync` for user settings (on/off, sensitivity, allowlist, API key);
  `chrome.storage.local` for the verdict cache and bundled blocklist.
- **Tests:** `vitest` for the pure engine. A **golden fixtures file** of URLs → expected verdicts
  is the source of truth (see §6).

## 4. Repo conventions

- Module layout is defined in `PLAN.md` §"File tree". Keep files small and single-purpose.
- Every detection check is its own function returning `{ id, hit: boolean, weight, reason }`, added
  to a registry — so new checks are one file + one test, never a giant if-tree.
- Messaging between content script and service worker uses a **typed contract** documented in
  `PLAN.md` §"Message contract". Don't invent ad-hoc message shapes.
- Comments explain *why*, not *what*. Security-relevant code gets a comment tying back to a golden
  rule.
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Small, reviewable commits.

## 5. How to run / test the extension

1. `npm install`. (React/Framer Motion are runtime deps of the two bundled pages only — ADR-0001.)
2. `npm run build` (or `npm run watch`). Required before loading.
3. `npm test` — runs the engine unit tests + golden fixtures. **Must be green before any commit.**
4. Load unpacked: Chrome → `chrome://extensions` → enable Developer mode → "Load unpacked" →
   select **`dist/`**.
4. Manual smoke test against `tests/manual/phishing-sandbox.html` (a local page of safe + crafted
   dangerous links — never live malware) and confirm badges match expectations.
5. Reload the extension after changes; content-script changes need a page refresh.

## 6. Definition of done (per feature)

- Pure logic covered by a vitest test; new URL patterns added to `tests/fixtures/urls.json`.
- No new permission added to `manifest.json` without a justifying comment.
- No network call on hover for allowlisted/known-safe domains (verify in the Network panel).
- Badge renders correctly in light + dark, doesn't intercept clicks, cleans up on mouse-out.
- `npm test` green; manual smoke page passes.

## 7. Out of scope for v1 (park these)

Full-page content scanning, form/credential-field warnings, enterprise policy sync, a hosted
backend, ML models. Note good ideas in `PLAN.md` §"Backlog" instead of building them.

## 8. When unsure

Ask, or write the assumption at the top of your change and proceed. Prefer the boring, secure,
well-tested path over the clever one. The whole point of this product is trust.
