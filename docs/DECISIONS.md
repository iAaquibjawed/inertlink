# Decision log (ADRs)

Two lines per non-obvious choice: what we chose, over what, and why. Future sessions read this so
they extend the design instead of reinventing or reversing it (PLAN.md §4.5).

Newest last. Never delete an entry — supersede it.

---

## ADR-0001 — Popup and options are React; a build step now exists

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** React 19 + Framer Motion for `src/popup/` and `src/options/`, bundled with esbuild into
`dist/`.
**Over:** vanilla JS with no build step, as CLAUDE.md §3 originally specified.

**Why:** The user asked for Framer Motion. Framer Motion requires React, and React requires a
bundler. CLAUDE.md §3 said "introduce a bundler only when module loading forces it, and record why
in PLAN.md" — this is that moment, and this is the record.

**Consequences:**
- `npm run build` is now required before loading the extension. The unpacked target is **`dist/`**,
  no longer `src/`.
- `package.json` now has runtime dependencies, which CLAUDE.md §3 said it wouldn't. Everything is
  inlined at build time, so golden rule 1 (no remote code) still holds — esbuild resolves every
  import into the shipped bundle and nothing is fetched at runtime.
- CLAUDE.md §3 and §5 were updated to match. The manual is the contract; it can't be left stale.

**Cost accepted:** ~345kb per bundled page. Paid only when the user opens the popup or options —
never on a web page.

---

## ADR-0002 — The hover badge stays vanilla

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** `src/content/badge.js` renders with plain DOM + Web Animations API, in a closed shadow
root, with tokens inlined as a string.
**Over:** mounting React + Framer Motion into the badge's shadow root for consistency with the
popup.

**Why:** The content script runs on **every page the user grants**. React + Framer Motion is ~60kb
of parse and execute per page, for a tooltip that shows three lines of text. That directly
threatens golden rule 6 (never break the sites the user is browsing) and PLAN.md §6's performance
risk (hover must feel instant). WAAPI gives us the same spring-free enter/exit for zero bytes.

**Consequences:**
- Two motion implementations exist. They are kept in sync by both deriving from
  `design-system/linkverify/MASTER.md` §5 — same durations, same easings, same reduced-motion rule.
- The badge cannot use `layoutId` or `AnimatePresence`. It doesn't need them; it has one element
  and two states.
- A `<link>` to `shared/tokens.css` was also rejected for the badge: a stylesheet request from a
  content script is a fetch the host page can observe, and a cascade it can interfere with.

---

## ADR-0003 — No static `content_scripts`; register dynamically after the user grants a host

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** `manifest.json` declares **no** `content_scripts` key. It requests `storage` +
`scripting`, and lists `http://*/*` + `https://*/*` under `optional_host_permissions`. Phase 2 calls
`chrome.scripting.registerContentScripts()` once the user grants a host.
**Over:** `"content_scripts": [{ "matches": ["<all_urls>"] }]`.

**Why:** Golden rule 4 — least privilege. A static `<all_urls>` content script means the extension
reads every page the user visits from the moment it's installed, and the Chrome Web Store install
prompt says exactly that. Optional host permissions move the decision to the user, per site, at the
moment it matters. It also means a Phase 0 install genuinely does nothing, which is what Phase 0
promised.

**Consequences:**
- The popup needs an "enable on this site" affordance (Phase 2/4) — there is no other way for the
  user to grant.
- Nothing runs on any page until a grant exists. Expected; not a bug.
- `minimum_chrome_version: 116` is set because `registerContentScripts` with dynamic origins needs
  a recent Chromium.

---

## ADR-0004 — No CDN font; Inter ships locally or we fall through to the system stack

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** `--lv-font-sans: "Inter", <system stack>` with no `@import`.
**Over:** the `fonts.googleapis.com` import the design-system generator emitted.

**Why:** Two independent reasons. (1) MV3's `extension_pages` CSP blocks remote subresources, so it
wouldn't load anyway. (2) Golden rule 2 — a CDN font is a request to Google every time the user
opens the popup, from a product whose whole pitch is that it doesn't phone home.

**Consequences:** Until Inter is bundled under `assets/fonts/` (Phase 5), the UI renders in the
system UI font. `build.mjs` has a `verifyNoRemoteRefs()` guard that fails the build if a CDN URL
reappears in a page.

---

## ADR-0005 — The design system's generated output was adapted, not adopted

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** Keep the generated palette, Inter, and the stagger concept. Replace the page pattern,
type scale, focus-ring color, and motion easing.
**Over:** using `ui-ux-pro-max --design-system` output verbatim.

**Why:** The generator classified LinkVerify as an "Insurance Platform" from its trust keywords and
returned a marketing-landing system: hero → proof logos → pricing → "Contact Sales", with
`clamp(3rem, 10vw, 12rem)` display type. LinkVerify has no landing page; its widest surface is a
360px popup. Three specific outputs were actively wrong:

1. `--color-ring: #1E293B` is the same value as `--color-primary` and near-identical to the dark
   background — an invisible focus ring, which is the generator's own listed anti-pattern. Replaced
   with `#38BDF8`.
2. `#EF4444` as destructive **text** measures ~4.2:1 on `#0F172A` — below AA. Split into per-mode
   verdict ramps; `#EF4444` survives as a fill only.
3. The motion preset's easing was `back.out(1.4)`, whose own note warns against overshoot on
   informational UI. A safety verdict that bounces reads as a toy. Replaced with a non-overshooting
   spring.

Every adaptation is marked **[adapted]** in `MASTER.md` with its reason, so the next session can
tell a deliberate override from a drift.

---

## ADR-0006 — Phase 0 returns `unknown`, never `safe`

**Date:** 2026-09-18 · **Phase:** 0 · **Status:** accepted

**Chose:** `scoring.js` returns `unknown` when no checks have run, `parseUrl()` returns `null`, and
the popup's placeholder verdict is `unknown`.
**Over:** defaulting to `safe` so the scaffold "looks finished".

**Why:** A green shield is a claim. With no engine behind it, it's a false one — and the single
worst failure mode this product has is telling someone a phishing link is safe. The scaffold must
be incapable of that, and there is a test (`never returns safe for an unparseable URL`) that keeps
it that way.

---

## ADR-0007 — The content script and the worker are bundled, not copied

**Date:** 2026-09-19 · **Phase:** 2 · **Status:** accepted

**Chose:** esbuild bundles `src/content/main.js` → `dist/content/content.js` as a **classic IIFE,
unminified**, and `src/worker/service-worker.js` → `dist/worker/service-worker.js` as ESM.
**Over:** copying `engine/`, `content/`, and `worker/` into `dist/` verbatim, as CLAUDE.md §3 and
ADR-0001 specified.

**Why:** Content scripts cannot be ES modules. Neither a static `content_scripts` entry nor
`chrome.scripting.registerContentScripts()` supports `import`, so a content script that imports the
engine simply does not run. The two alternatives were both worse:

- **Dynamic `import(chrome.runtime.getURL(...))`** works, but requires listing `engine/`,
  `content/`, and `shared/` under `web_accessible_resources` — which makes those files fetchable by
  any page and turns the extension into a fingerprinting signal. Paying a privacy cost to satisfy a
  build preference is backwards for this product.
- **Hand-inlining the engine into one file** would mean the code that runs on users' pages is no
  longer the code in `src/`, which is the property that makes it auditable.

The worker is bundled for a smaller reason: it imports the engine's JSON data, and `import … with
{ type: 'json' }` needs a newer Chrome than `minimum_chrome_version: 116` promises.

**Consequences:**
- CLAUDE.md §3 updated — "copied verbatim into `dist/`" was true in Phase 0 and is no longer.
- ADR-0002 still holds and is now **enforced at build time**: `verifyContentIsLean()` fails the
  build if React, Framer Motion, or react-dom reach `content.js`, or if it exceeds 80kb.
- `content.js` ships **unminified**, unlike the popup and options bundles. This is the code that
  runs on other people's pages; a reviewer must be able to read it against `src/` without a
  sourcemap. The size cost (~52kb, mostly the bundled JSON reference data) is worth it.
- `dist/shared/` still exists as a verbatim copy, because both HTML pages `<link>` to
  `shared/tokens.css`.

---

## ADR-0008 — `alarms` and `activeTab`, and why not `tabs`

**Date:** 2026-09-19 · **Phase:** 4 · **Status:** accepted

**Chose:** add `alarms` and `activeTab` to `manifest.json` permissions. Keep `optional_host_permissions`
for everything else.
**Over:** adding `tabs` (which would read every tab's URL), or `<all_urls>`.

**Why (golden rule 4 — this is the justifying comment CLAUDE.md §6 requires; `manifest.json` is
strict JSON and cannot hold one):**

- `alarms` — the weekly blocklist refresh. An MV3 worker sleeps, so `setTimeout` cannot schedule
  anything that outlives a wake. The alarm is a no-op unless the user has enabled online checks
  *and* supplied a feed URL, so the default install still makes zero requests.
- `activeTab` — the popup needs the current tab's URL to show which host it is talking about and to
  request permission for that specific origin. `activeTab` grants this only for the tab the user
  just acted on, only after they clicked the toolbar icon, and it expires. `tabs` would grant the
  URL of every tab, permanently, which is strictly more than the popup needs.

**Consequences:** the install prompt stays minimal — no "read your browsing history" string, which
is what `tabs` produces. Per-site access remains a decision the user makes per site, at the moment
it matters.

---

## ADR-0009 — The manifest lives in `src/`, never the repo root

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** `src/manifest.json`, copied to `dist/manifest.json` by the build.
**Over:** `manifest.json` at the repo root, which is where every Chrome extension tutorial puts it.

**Why:** A root manifest makes the repo root *look* like a loadable extension. "Load unpacked" on
the root **succeeds** — the manifest is valid JSON with valid keys — and then every path inside it
404s: no service worker, a broken popup, no content script. Chrome reports no error for this. The
result is an extension that installs cleanly and does nothing, which is indistinguishable from a
bug in our own code and cost a full debugging session to find.

Since ADR-0001 the unpacked target has been `dist/`, so a root manifest was never correct — it was
a leftover from the pre-build layout that survived as a trap.

**Consequences:**
- Picking the repo folder in "Load unpacked" now fails immediately and legibly with "Manifest file
  is missing or unreadable". The mistake is no longer silent.
- `build.mjs` gained `verifyManifestResolves()`: every path the manifest names — worker, popup,
  options page, all icon sizes, plus the dynamically-registered `content/content.js` — must exist
  in `dist/` or the build fails. Chrome will not check this for us, so we check it.
- README and PLAN.md §4 updated. The install step is unchanged: select `dist/`.

---

## ADR-0010 — `activeTab` activates; the host permission only makes it persist

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** opening the popup injects the content script into the current tab immediately, using the
`activeTab` grant that clicking the toolbar icon confers. `permissions.request()` is now an
*upgrade* — "always run on this site" — not a precondition for anything working.
**Over:** the original flow, where nothing ran anywhere until `permissions.request()` resolved.

**Why:** the original flow put the entire product behind a native permission dialog, and that
dialog is not reliable from an action popup. Chrome tears the popup down when the prompt opens; on
some platforms that cancels the request. The user clicked "Turn on for this site", the popup
vanished, and nothing ever happened — with no error anywhere, because from the extension's point of
view the user simply declined.

This was measured, not guessed. A CDP harness (`tests/e2e/`) driving a real Chrome showed
`chrome.permissions.request()` **never resolving** without a dialog to answer, while every other
link in the chain — worker start, script registration, injection, hover, badge — passed. The
prompt was the only broken step, and it was load-bearing for everything.

`activeTab` has no dialog, cannot be cancelled, and is strictly narrower than a host permission: it
covers one tab, granted by an explicit click, and expires. Using it for activation is also more
honest about what the user asked for — they clicked the icon on *this* page.

**Consequences:**
- The extension works on the first click, on the page the user is already looking at, with no
  prompt. That is the behaviour a user expects and previously never got.
- The grant button now reads "Always run on <host>" once it is already running, and explains that
  the grant is about surviving reloads and navigation.
- Pause and per-tab counts are available whenever it is running, granted or not.
- `ENSURE_INJECTED` injects *before* it re-registers: registration is about the next navigation and
  must never block working on the current tab.
- Without a grant, protection lasts for the visit. Navigating away ends it — which the popup says.

---

## ADR-0011 — An end-to-end test that runs the real extension

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** `npm run e2e` — a dependency-free CDP harness that installs `dist/` into a throwaway
Chrome profile and asserts the extension actually works.
**Over:** relying on `npm test` (the pure engine) plus manual hovering.

**Why:** every real failure this project has had was invisible to the unit tests, which stayed
green throughout: a manifest whose paths resolved to nothing (ADR-0009), and a permission prompt
that never resolved (ADR-0010). "The engine is correct" and "the extension runs" are different
claims, and only one of them was ever being checked.

**What it covers:** install → worker starts → content script registered for the granted origin only
→ injected into a page → seven fixture links hovered for real, with the verdict read back out of
the content script's own tally → zero off-origin requests while hovering (golden rule 3) → the
activeTab injection path.

**Notes for whoever touches it next:**
- Chrome 136+ **removed `--load-extension`**. Passing it does nothing, silently. Installation now
  goes through CDP `Extensions.loadUnpacked`, which is refused over the TCP debugging port — hence
  `--remote-debugging-pipe` and the NUL-delimited framing in `tests/e2e/cdp.mjs`.
- The native permission dialog is browser UI and cannot be driven. The test profile is given the
  origin up front, so everything downstream of the prompt runs for real.
- `HEADED=1 npm run e2e` to watch it.

---

## ADR-0012 — "Run on every site" is offered, not hidden

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** a one-click "Run on every site automatically" control in both the popup and options,
requesting both `optional_host_permissions` patterns at once.
**Over:** per-site grants only, which was the shipped behaviour after ADR-0010.

**Why:** ADR-0010 made the extension work on the first click of the toolbar icon, with no prompt.
But `activeTab` is scoped to one invocation on one tab — so the user had to click the icon again on
every new site, and again after navigating. For a tool whose whole value is being there *before*
you click a link, "remember to activate me first" is close to useless.

Least privilege (golden rule 4) means the *default* is narrow and the user decides — not that we
refuse to let them decide. Nothing here is requested at install; the broad grant is opt-in, clearly
labelled with what it means ("LinkVerify can read the pages you visit to check their links"), and
revocable from the same two places.

**Consequences:**
- Three access levels, in order of how much the user has opted into: click-the-icon (`activeTab`,
  per visit), per-site grant, all sites.
- The "run everywhere" link sits *below* the per-site button and is styled as a quiet link. Broader
  access should never be the easier thing to click.
- `registerableOrigins()` (`src/shared/origins.js`, unit-tested) collapses an all-sites grant so we
  do not register the same script twice on hosts covered by both a broad and a specific pattern.
- Per-site "Remove access" is hidden while an all-sites grant is active — removing one host from it
  would do nothing, and a control that does nothing is a lie.
- `npm run e2e` covers the all-sites path end to end: a second extension copy installs with both
  broad patterns and a fresh tab badges with no click and no per-site grant.

---

## ADR-0013 — The badge lives in the top layer, and the host carries the z-index

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** `z-index: 2147483647` on the shadow **host** element, plus `popover="manual"` +
`showPopover()` to put it in the top layer.
**Over:** `z-index: 2147483647` on `.lv-badge` inside the shadow root, which is what shipped.

**Why:** the original z-index did nothing. A `position: fixed` element always creates a stacking
context, so the badge's z-index was scoped *inside* the host and competed with nothing on the page.
The host itself, styled with `all: initial`, had `z-index: auto` — which any positioned page
element with `z-index: 1` or more paints over.

Found on a real site (a portfolio with a sticky `nav` at `z-index: 100`): hovering the nav links
produced a verdict that was computed correctly, rendered correctly, and then covered completely by
the site's own header. Silent, and indistinguishable from "the extension didn't fire". A modest
z-index on site chrome is not exotic — this affected an ordinary majority of sites, anywhere the
cursor sat near a header, sidebar, or sticky footer.

The top layer is the belt to that z-index's braces: it sits above every z-index on the page and is
not clipped by an ancestor's `overflow`, `transform`, `filter`, or `contain` either — the other
half of this failure mode, which we had not hit yet but would have.

**Consequences:**
- `popover` is set in a `try` and `showPopover()` is wrapped: it throws if the element is already
  open or not connected, and a throw in the badge must never break the host page (golden rule 6).
  On a browser without popover support the z-index alone still covers every ordinary page.
- `showBadge()` re-asserts both the connection and the top-layer state on every call, so a
  single-page app that rewrites `document.body` cannot silently drop us out of the document.
- `minimum_chrome_version` is already 116; the Popover API landed in 114.
- The smoke page gained a `z-index: 100` sticky nav as a permanent visual fixture, and
  `npm run e2e` asserts the host's computed z-index, that it outranks that nav, and that it is
  actually in the top layer (`:popover-open`).

---

## ADR-0014 — Badge redesign: severity in the surface, the owner as the hero

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted · **Supersedes:** the §4.1 spec in MASTER.md

**Chose:** one silhouette, a quiet → tinted → solid surface ladder, a 10px caps eyebrow, and the
registrable domain emphasised inside the host.
**Over:** the shipped badge — a 3px left verdict bar, a full accent outline plus an outer ring on
danger, a radius that changed with content, and a 15px verdict word above a smaller host.

**Why:**

1. **Four encodings of one fact.** Severity was carried by the glyph, the accent colour, a 3px left
   bar, and — on danger — a 2px accent outline *and* a 1px outer ring. The left bar was the clearest
   offender: offset from the glyph, aligned to nothing, it read as an artifact rather than
   structure. On danger the stack resolved into something that looked like a form-validation error,
   not a warning. Severity is now carried once, by the surface.

2. **The silhouette lied.** Radius went pill → rounded-rect based on whether a reason line was
   present. That looks like it encodes severity; it encodes text length. One radius now, always.

3. **The hierarchy was backwards.** The verdict word was the largest element, but by the time you
   read a word you already know the answer from colour and shape. The *host* is the fact you need,
   and it was set smaller than the word describing it. The word is now a 10px caps eyebrow and the
   host is the hero. The word stays — colour must never be the only encoding.

4. **The palette was the framework default.** `#4ade80 / #fbbf24 / #f87171` is the status-chip ramp
   every product ships. Retuned as a set: warmer jade and vermilion that separate from the cool
   slate surface, and a danger that means "stop" rather than "invalid field". AA verified in both
   themes (dark: 9.3 / 10.4 / 5.6 / 7.1; light: 5.6 / 6.1 / 6.3 / 7.6).

**The signature:** the host renders `example.com.` at 50% and **`secure-billing.invalid`** at full
weight — the registrable domain, the one string that answers "who actually owns this link". The
badge stops merely grading the link and starts showing you where to look, which is exactly the
deception `deceptive-subdomain` and `userinfo-trick` exist to catch. `splitHost()` falls back to
emphasising the *whole* host when it cannot identify the owner — never the reverse, because
emphasising the wrong half would point the user at the attacker's text.

**Boldness is spent in one place.** Danger — roughly 1% of hovers — gets a solid fill and a coloured
shadow. Safe, caution, and unknown stay quiet. A badge that shouts on every hover is a badge people
turn off.

**Consequences:**
- `showBadge()` takes `registrable`; `hover.js` passes `parsed.registrable` through.
- Both halves of the host are set with `textContent`, never `innerHTML` — the host string is
  attacker-controlled.
- `--lv-on-fill` added to `tokens.css` for ink on a saturated fill; the popup's verdict colours move
  with the same ramp so the two surfaces stay one system.
- Content script grew ~2kb, still far inside the 80kb budget.

---

## ADR-0015 — Form submit controls are checked; `href="#"` is not

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** resolve a hover target from `<a href>` **or** from a submit control's form action
(`formaction` || `form[action]`), and keep ignoring anchors whose href is `#`.
**Over:** only ever reading `<a href>`, which is what shipped.

**Why:** measured on a real Amazon cart. The three controls in a cart row are:

| control | what it actually is | verifiable? |
|---|---|---|
| Delete | `<input type="submit">` in `<form method="post" action="…">` | **yes — we were silent** |
| Save for later | same | **yes — we were silent** |
| Share | `<a href="#" role="button">` | no — `#` goes nowhere |

An `<a href>` is not the only way a click navigates. A submit button leaves the page exactly like a
link does, and phishing kits POST credentials to attacker endpoints through precisely this
mechanism — so a submit control's destination is the core question this product exists to answer,
not an extension of scope. `<button type="button">` and `<a href="#">` stay silent because there is
genuinely nothing to verify, and inventing a badge for a destination that does not exist would be a
lie in a product whose entire value is not lying about destinations.

**This is not the credential-field warning parked in CLAUDE.md §7.** That backlog item is about
flagging *input fields* on a page. This is about where a *click* goes.

**Consequences:**
- `anchorFrom()` became `targetFrom()`, returning `{ el, url, text }`. A `<button>` with no `type`
  defaults to submit and is included; `type="button"` and `type="reset"` are not.
- A form whose action resolves to the current page is skipped — it tells the user nothing.
- Reading `action` is string inspection. Nothing is submitted and nothing is fetched (golden rule 3).
- Anchor text is empty for submit controls, so `text-href-mismatch` cannot fire on a button label —
  correct, since "Delete" makes no claim about a destination.
- The smoke page gained a "Not links, but they still navigate" section, and `npm run e2e` asserts
  all four cases including the two that must stay silent.

---

## ADR-0016 — `javascript:void(0)` is not a threat; it is an **InertLink**

**Date:** 2026-09-19 · **Phase:** 5 · **Status:** accepted

**Chose:** an href that points at nothing (`#`, `javascript:void(0)`, `javascript:;`) is named an
**InertLink** and gets its own quiet badge state, not a verdict. `javascript:` with a real body is **caution**. `blob:` is not flagged at all.
**Over:** one flat "dangerous scheme" tier that rendered all of them as **Danger**.

**Why:** found on a production page. `amazon.in/gp/cart` has **fourteen** `javascript:void(0)`
anchors — Search, Cart, Home, Orders, Update, "See more categories", a product promo — and every
one of them rendered a red **Danger** badge reading "Runs javascript code instead of opening a
page". Technically true. Completely useless, and actively harmful: PLAN.md §6 names false positives
as the top risk precisely because a user who sees red on every menu of a legitimate site learns to
ignore red, and then ignores the one that mattered.

The tiers were wrong on the evidence:

- **Inert placeholders execute nothing and navigate nowhere.** They are the standard way to mark a
  control driven by a click handler. There is no signal here at all.
- **`javascript:` with real code runs in the page's own origin**, which the site already fully
  controls — an inline handler grants it nothing new. Worth "check you trust this site"; not worth
  "you are being robbed".
- **`blob:` is how ordinary sites hand you a generated file.** Flagging every download button was a
  false positive with no threat behind it; the page already had the bytes.
- **`data:text/html` stays at danger.** It renders fully attacker-authored markup, and unlike
  `javascript:void(0)` it is vanishingly rare in normal browsing — frequency is what decides the
  tier, because the cost of over-warning scales with how often you do it.

**Silence was also wrong.** The first fix skipped InertLinks entirely. That produced the
opposite complaint, and a fair one: Amazon's cart "Share" is an `<a href="#">`, and Chrome prints a
URL in the status bar for it. The anchor *presents itself as a link* — pointer cursor, status bar,
everything — so showing nothing is indistinguishable from the extension being broken. If something
claims to be a link, we answer. A plain `<button>` makes no such claim and still gets nothing.

**Consequences:**
- New display-only badge state `inertlink`, labelled **InertLink**, styled as the quiet neutral. It is not a
  safety judgement and is deliberately **not** counted in the per-tab tally.
- `isInertLinkHref()` lives in `parse.js` (pure, exported) so the engine and the content script agree.
  `parseUrl()` returns `null` for an InertLink, so the engine still answers `unknown` — never `safe`.
- Copy across the scheme check now invites verification instead of asserting harm. A warning the
  user cannot act on is a warning they learn to dismiss.
- Fixtures gained the InertLink, `javascript:`-with-body, and `blob:` cases; `npm run e2e` asserts the
  badge appears for InertLinks and that `javascript:` with a body reads caution.
