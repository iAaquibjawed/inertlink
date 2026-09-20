# InertLink — Logo Design Brief

> Everything a designer needs to create the InertLink logo. This brief is deliberately complete:
> brand strategy, logo theory, concept directions, exact specs, and deliverables. It is grounded in
> the existing design system (`design-system/inertlink/MASTER.md`) — the logo must live in the same
> world as the product, not beside it.
>
> Read `design-system/inertlink/MASTER.md` and `CLAUDE.md` alongside this. Where they conflict, the
> design system wins on color/type tokens; this brief wins on logo-specific decisions.

---

## 1. The one-paragraph brief (if you read nothing else)

Design a logo for **InertLink**, a Chrome extension that tells you whether a link is safe *before*
you click it — a small badge appears when you hover. The name means a link made **inert**: harmless,
neutralized, safe to touch. The logo must feel like **calm, trustworthy security** — not alarmist,
not toy-like, not another generic padlock. It has to work as a tiny extension icon at **16×16 px**
first and scale up gracefully. Primary color is **slate `#1E293B`**, with a **green `#22C55E`**
accent for "safe." One strong, simple mark that reads instantly at favicon size is worth more than
anything clever that dies when shrunk.

---

## 2. Brand foundation (the *why* behind the mark)

**Product.** Hover-time link safety. On hover, InertLink runs local heuristics (typosquatting,
punycode, IP-host logins, deceptive subdomains, text-vs-href mismatch…) and shows a verdict badge:
🟢 Safe, 🟡 Caution, 🔴 Danger. It's privacy-first (most checks never touch the network) and it's a
quiet guest on every page you browse.

**The name.** "Inert" = chemically unreactive, harmless, unable to cause harm. InertLink = *the link,
made safe to touch.* This is the single richest idea for the mark — the logo can express
**neutralizing a threat**, or **a safe/verified link**, rather than defaulting to a shield.

**Mission.** Give people a moment of certainty before they click — the highest-stakes, lowest-effort
security decision most people make dozens of times a day.

**Personality (design these into the mark).**

| Is | Is not |
|---|---|
| Calm, quiet, reassuring | Alarmist, fear-mongering |
| Precise, technical, credible | Playful, cartoonish, "app-y" |
| Modern, minimal, geometric | Ornate, retro, skeuomorphic |
| Trustworthy, institutional-but-approachable | Corporate-cold, or startup-gimmicky |
| Protective without being aggressive | Militaristic, "cyber-edgy," neon-hacker |

**Brand adjectives to hold in your head while sketching:** *inert, guarded, clear, instant,
grounded.*

**Audience.** Everyday browsers who worry about phishing (older relatives, non-technical
professionals) **and** the security-aware (developers, IT, privacy folks) who will judge it on
whether it looks competent. The mark must earn trust from both — approachable enough for the first,
credible enough for the second.

**Where the logo appears (this dictates the design):**
- **Chrome toolbar / extension icon** — 16px is the real one; also 32, 48, 128 (files already exist
  at `assets/icons/`, currently placeholders to replace).
- **Favicon** for any site/store listing (16px again).
- **Chrome Web Store listing** — 128px tile + promotional images.
- **Popup and options page** header (small, next to "InertLink" wordmark).
- **README / docs / marketing site** (`site/`).
- One-color contexts: browser chrome, print, engraving, a stamp on a screenshot.

---

## 3. Logo theory — the rules every mark here must satisfy

A designer should be able to check the finished logo against these. All seven are non-negotiable for
InertLink because it lives at icon size in a trust-critical product.

1. **Simple.** Few elements, one idea. Complexity dies at 16px and weakens recall. If you can't
   describe it in one sentence, it's too much.
2. **Memorable & distinctive.** Someone should recognize it after one glance in a crowded toolbar.
   Avoid anything interchangeable with the 10,000 other shield/lock logos (see §4).
3. **Scalable / resolution-independent.** Vector-native (SVG). Must survive from 16px to a billboard
   with no redraw. **The 16px test is the gate** — design *at* 16px, then scale up, not the reverse.
4. **Versatile.** Works in full color, single color, black-on-white, white-on-black (knockout), and
   as a solid silhouette. Works on light pages and dark ones (this product is dual-theme by nature).
5. **Appropriate.** Reads as *security/trust utility*, calm register. Not a game, not a bank, not a
   crypto coin.
6. **Timeless.** No trend-chasing (no gradients-of-the-year, no bevels, no glossy web-2.0). It should
   look right in ten years.
7. **Balanced & intentional.** Optical alignment, consistent stroke logic, deliberate negative space.
   Nothing accidental.

**The overriding constraint: legibility at 16px.** At that size you have roughly a 14px live area and
a handful of pixels of detail. That means: one dominant shape, thick/confident strokes (never
hairlines), high contrast against both light and dark toolbars, and no fine interior detail that
turns to mud. Test every concept as a 16px PNG before falling in love with it.

---

## 4. Competitive & visual landscape (so you don't blend in)

Security/trust software leans hard on a small cliché set:

- **Padlocks** — the default "security" symbol; instantly generic, and browsers already own the lock
  (the address-bar padlock), so borrowing it invites confusion.
- **Shields** — extremely common (antivirus, VPNs, "protect" everything). Usable *only* if you do
  something genuinely distinctive with it. A plain shield alone is invisible in this category.
- **Checkmarks / ticks** — "verified/safe"; overused but meaningful; strongest when *integrated* into
  another form, not stuck on top.
- **Eyes** — "we're watching"; reads surveillance/creepy — avoid for a privacy-first product.
- **Green + a symbol** — the whole category signals safety with green, which is why relying on green
  alone is weak.

**How InertLink stands apart:** lean on what's unique — **the link + the idea of "inert/neutralized"
+ the hover moment.** A mark that fuses a *link/chain-link* with a *safety cue*, or that shows a link
"made calm," is far more ownable than a bare shield. Your own product already uses the Lucide
`shield-check` and `octagon-alert` glyphs for verdicts — the logo should feel related to that visual
family without simply *being* the shield-check icon (that's a UI glyph, not a brand mark).

---

## 5. Concept directions to explore

Bring at least 3–4 of these to sketch. Don't polish early — thumbnail widely first.

1. **The inert link / neutralized chain.** A single chain-link (the universal "link" symbol) shown
   calm, closed, or "sealed" — e.g., one link whose gap is closed by a small checkmark or a solid
   node. Expresses the name directly: the link is made safe. *Most ownable direction.*
2. **`il` monogram → mark.** The two letters of "InertLink" (or "IL") built into a compact geometric
   symbol. A lettermark scales beautifully to 16px and is instantly brandable. Explore the dot of a
   lowercase `i` becoming the "safe" node, or the `l` becoming a link/bar.
3. **Cursor-shield.** The mouse cursor/pointer (the hover gesture is the product) forming, or nested
   inside, a shield or a rounded safe-zone. Ties the mark to the actual interaction.
4. **Hover halo / safe node.** A link-dot with a calm ring or "cleared zone" around it — the moment
   of verification made into a symbol. Minimal, abstract, works tiny.
5. **Shield done differently.** If you use a shield, subvert it: form the shield *out of* a link
   shape, or from the negative space of two chain-links, or round it to feel calm rather than
   martial. A checkmark integrated as the shield's own edge, not pasted on top.
6. **The verdict glyph lineage.** An abstract mark that echoes the geometry of `shield-check`
   (rounded, 2px-stroke, confident) so the brand and the in-product icons read as one system —
   without copying the UI glyph verbatim.

Recommended starting bet: **#1 or #2**, because they own the *name* and the *category* respectively,
and both survive 16px. A **combination mark** (symbol + "InertLink" wordmark) is the likely final
form, with the symbol alone as the extension icon.

---

## 6. Logo types — pick the system, not just a picture

Deliver a **combination mark** with parts that work independently:

| Type | Use it as | Notes |
|---|---|---|
| **Brandmark / symbol** (the icon alone) | Extension icon, favicon, app tile, avatar | The 16px workhorse. Must stand alone. |
| **Wordmark** ("InertLink") | Docs, site header, store title | Set in the brand font, custom-spaced. |
| **Combination** (symbol + wordmark) | Primary logo, marketing, popup header | Horizontal lockup is primary; stacked is secondary. |
| **Lettermark** ("il" / "IL") | Tiny contexts, loading states, watermark | Optional, if the monogram direction wins. |

You are effectively designing **one symbol that must also be an OS/browser app icon.** Treat the
extension icon as the hero deliverable.

---

## 7. Color

Use the existing brand tokens — do not introduce a new palette.

| Role | Hex | Where |
|---|---|---|
| **Primary (brand ink)** | `#1E293B` (slate-800) | The mark's default color; wordmark |
| **Accent (safe/positive)** | `#22C55E` (green-500) | A single accent detail — the "safe" cue |
| **On-dark foreground** | `#F8FAFC` | Knockout mark on dark toolbars/backgrounds |
| **Dark background** | `#0F172A` (slate-900) | App-icon background option |
| **Danger (use sparingly, if at all)** | `#EF4444` | Generally *not* in the logo — that's a verdict color, and the brand should feel calm, not alarmed |

**Color rules:**

- **Design in one color first.** The logo must be fully legible as solid `#1E293B` (light bg) and
  solid `#F8FAFC` (dark bg) with *zero* color. Color is an enhancement, never load-bearing —
  consistent with the product's "never rely on color alone" principle.
- **Green is a spice, not the dish.** At most one green element (a node, a checkmark, the closed gap
  of a link). A logo drowning in green just says "generic safe app."
- **No gradients, no glows, no AI-purple/pink.** The design system explicitly bans purple/pink
  gradients — a security tool that looks like a toy isn't trusted. Flat, solid fills only.
- **App-icon color:** provide both a light-background and a dark-background (`#0F172A`) version. On
  dark, the mark is `#F8FAFC` with the green accent; on light, `#1E293B` with green accent.
- **Contrast:** the mark must clear **3:1** against whatever it sits on. Extension icons land on
  light *and* dark Chrome themes — verify both.

---

## 8. Typography (for the wordmark)

- **Family: Inter.** It is the brand typeface (`--il-font-sans`), it ships in the package, and it
  keeps the logo consistent with every product surface. Do not introduce a display font.
- **Weight:** the wordmark reads best around **600–700 (SemiBold/Bold)**. Match the symbol's visual
  weight so neither overpowers the other.
- **Case & spelling:** **"InertLink"** — one word, camel-case (capital I, capital L) is the preferred
  styling; it makes the two halves of the name legible and pairs with an `il`/`IL` monogram. Confirm
  final casing with the founder before locking.
- **Letter-spacing:** slightly tight, roughly `-0.01em` to `-0.02em` at logo size, optically
  corrected — don't trust metrics blindly; kern the pairs by eye (especially `rt`, `tL`).
- **Custom touch (optional):** a small, restrained tweak — e.g., the dot of the `i` echoing the
  symbol's "safe node," or a subtle ligature — can make the wordmark ownable without redrawing the
  whole alphabet. Keep it legible.
- Wordmark must remain readable down to ~80px wide; below that, use the symbol alone.

## 9. Icon/mark style (so it belongs with the product)

The in-product verdict icons are **Lucide**: geometric, rounded joins, roughly **2px stroke on a
24px grid**, open and friendly but precise. Match that language so the brand mark and the UI feel
like one family:

- **Geometry:** built on a clean grid, from circles/arcs and straight segments — constructed, not
  hand-drawn.
- **Corners:** slightly rounded (calm, approachable), not sharp/martial, not fully soft/blobby.
- **Stroke logic:** if the mark uses strokes, keep them consistent and **thick enough to hold at
  16px** (a 2px Lucide stroke on a 24px glyph is far too thin once the whole logo is 16px — the mark
  needs bolder, simplified forms than a UI icon). Prefer **solid/filled** shapes for the icon at tiny
  sizes; a stroked version can exist for larger use.
- **One focal element.** Follow the design system's "one bold focal element per view."

---

## 10. Technical & construction specs

**Grid & construction.** Build on a standard icon grid (24px or 48px base, or a 1000-unit vector
grid). Use a **keyline grid** (circle, square, horizontal/vertical rectangles) so proportions feel
harmonious across shapes. Align optically, not just mathematically.

**Clear space (exclusion zone).** Keep a margin of at least the **cap-height of the wordmark** (or,
for the symbol, **25% of the symbol's width**) clear on all sides. Nothing intrudes into it.

**Minimum sizes.**

| Context | Min size | Form |
|---|---|---|
| Extension icon / favicon | **16px** | Symbol only, simplified |
| Toolbar / small UI | 24–32px | Symbol only |
| App tile / store | 48–128px | Symbol (full detail) |
| Combination lockup (horizontal) | ~120px wide | Symbol + wordmark |
| Wordmark alone | ~80px wide | — |

**App-icon safe area / padding.** For the 128px Chrome Web Store tile and OS-style icons, keep the
mark within a centered **safe zone** (~80% of the canvas) so it isn't clipped by rounded masks; leave
consistent padding. Provide a version *with* an icon background (rounded-square, `#0F172A` or white)
and a *transparent* version.

**Pixel-fitting the small sizes.** The 16/32/48px raster exports should be individually checked (and
if needed, nudged/hinted) so edges land on pixel boundaries — auto-downscaling from the 128px master
often produces blur. These may warrant slight per-size simplification (fewer details at 16px).

**File/format requirements.**

- **Master:** `SVG` (optimized, minimal nodes, no embedded rasters, strokes converted to paths for
  the final).
- **Raster:** `PNG` with transparency at **16, 32, 48, 128** (matches `assets/icons/` and the MV3
  `manifest.json` icon set) — plus 256/512 for stores/retina.
- **Favicon:** `favicon.svg` + `favicon.ico` (multi-res 16/32/48).
- **Color variants:** full-color, all-black, all-white (knockout), on-dark, on-light.
- Keep the SVG clean enough to inline in the popup/options without a build step (consistent with the
  vanilla, no-remote-code constraints).

---

## 11. Do's and don'ts

**Do**
- Design the symbol at 16px first, then scale up.
- Keep it to one clear idea; prefer solid shapes for the icon.
- Make it legible in pure black and pure white.
- Tie it to the name ("inert/safe link") or the interaction (hover) for distinctiveness.
- Match the Lucide/geometric language of the product's icons.
- Test on a busy Chrome toolbar, both light and dark themes.

**Don't**
- Don't default to a plain padlock or a generic shield.
- Don't rely on color (especially red/green) to carry meaning.
- Don't use gradients, glows, drop shadows, 3D, or purple/pink "AI" styling.
- Don't add fine interior detail, thin hairlines, or text inside the symbol.
- Don't use the literal Lucide `shield-check` UI glyph as the brand mark.
- Don't make it look aggressive/military or toy-like/cartoonish.
- Don't introduce a new font or new brand colors.

---

## 12. Deliverables checklist

**Concepts stage**
- 3–4 distinct directions as flat black thumbnails, each shown at **16px, 32px, and large**.
- Each concept on a light and a dark background.

**Final logo package**
- Primary combination lockup (horizontal) — SVG + PNG.
- Stacked/secondary lockup — SVG + PNG.
- Symbol/brandmark alone — SVG + PNG @ 16/32/48/128/256/512.
- Wordmark alone — SVG + PNG.
- Lettermark ("il") if that direction is chosen.
- Color variants: full-color, mono-black, mono-white, on-dark, on-light.
- Extension icons ready to drop into `assets/icons/` (16/32/48/128 PNG) + `favicon.svg`/`.ico`.
- App-icon versions: transparent + with background (rounded-square).
- A one-page **mini style guide**: clear space, min sizes, color values, correct/incorrect usage,
  the palette hexes, and the font.
- Editable source (the working vector file).

**Naming/placement (repo convention):** finished logo assets live in `assets/brand/` (new folder)
and the four extension icons replace the placeholders in `assets/icons/`. Keep names lowercase and
descriptive: `inertlink-logo-horizontal.svg`, `inertlink-mark.svg`, `inertlink-mark-mono-white.svg`,
`icon-16.png`, etc.

---

## 13. Suggested process (how a pro would run this)

1. **Discovery** — absorb this brief + the design system; note the personality words and the 16px
   constraint. Ask the founder any open questions (final name casing, whether a monogram is wanted).
2. **Research** — audit competitor marks (§4), collect what to avoid, find the whitespace to own.
3. **Sketch** — many rough thumbnails by hand across the §5 directions. Quantity first; no color.
4. **Select & digitize** — take 3–4 strongest into vector, on the construction grid.
5. **The 16px gauntlet** — export each at 16px early; kill anything that muddies. Refine survivors.
6. **Refine** — proportions, optical alignment, stroke weight, negative space; build the wordmark and
   lockups; add the single green accent.
7. **Present in context** — show on a real Chrome toolbar (light + dark), in the popup header, on the
   store tile, in one color. Context sells the right choice.
8. **Finalize & package** — outline strokes, optimize SVG, export all sizes/variants, write the mini
   style guide, hand off editable source.

---

## 14. Open questions for the founder (confirm before finalizing)

- Final name styling: **"InertLink"** (camelcase) vs "Inertlink" vs "INERTLINK"?
- Is a monogram (`il` / `IL`) wanted as a standalone asset?
- Any strong feeling on symbol direction (link vs monogram vs cursor vs shield)?
- Preference for the app-icon background: dark slate `#0F172A`, white, or transparent-only?
