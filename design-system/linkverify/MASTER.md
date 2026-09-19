# LinkVerify — Design System (Master)

> **LOGIC:** When building a specific surface, first check `design-system/linkverify/pages/<name>.md`.
> If that file exists, its rules **override** this Master file. Otherwise follow the rules below.
>
> Generated from `ui-ux-pro-max` (`--variance 3 --motion 4 --density 6`), then adapted for a
> Manifest V3 browser extension. Deviations from the raw generator output are marked **[adapted]**
> with the reason — see `docs/DECISIONS.md`.

**Project:** LinkVerify — hover-time link safety for Chrome
**Surfaces:** hover badge (content script, shadow DOM) · popup · options page
**Category:** security / trust utility **[adapted]** — generator guessed "Insurance Platform" off the
trust keywords and returned a marketing-landing pattern. LinkVerify has no landing page, no hero, no
CTA funnel. Pattern section replaced below.

---

## 0. Design principles (these outrank everything below)

1. **Calm by default, loud only when it matters.** 95% of hovered links are fine. A green badge must
   be nearly invisible; a red one must be unmissable. If every verdict shouts, the user stops reading.
2. **The badge is a guest on someone else's page.** It borrows nothing from the host page and gives
   nothing back — full shadow-DOM isolation, `pointer-events: none`, `all: initial` reset.
   (CLAUDE.md golden rule 7.)
3. **Never rely on color alone.** Each verdict carries a distinct SVG glyph and a distinct shape
   weight. ~8% of men have some form of color vision deficiency; red/green is the worst possible axis
   to encode a safety signal on. (Priority 1 — Accessibility.)
4. **Motion explains, never decorates.** The badge's entrance tells you *where it came from* (the
   cursor). Nothing animates for flourish. (Priority 7 — Animation.)
5. **Both themes are first-class.** The badge lands on unknown backgrounds — it follows
   `prefers-color-scheme` and carries its own contrast, never inheriting page colors.

---

## 1. Color

### Core palette

| Role | Hex | CSS variable |
|------|-----|--------------|
| Primary | `#1E293B` | `--lv-color-primary` |
| On primary | `#FFFFFF` | `--lv-color-on-primary` |
| Secondary | `#334155` | `--lv-color-secondary` |
| Accent | `#22C55E` | `--lv-color-accent` |
| Background (dark) | `#0F172A` | `--lv-color-bg` |
| Foreground (dark) | `#F8FAFC` | `--lv-color-fg` |
| Muted surface | `#272F42` | `--lv-color-muted` |
| Border | `#475569` | `--lv-color-border` |
| Destructive | `#EF4444` | `--lv-color-destructive` |
| Focus ring | `#38BDF8` | `--lv-color-ring` **[adapted]** |

**[adapted]** Generator returned `--color-ring: #1E293B` — identical to Primary and to the dark
background, so a focus ring would have been invisible in dark mode (Priority 1: "Invisible focus
states"). Swapped to sky-400 `#38BDF8`, which clears 3:1 against both `#0F172A` and `#FFFFFF`.

### Verdict colors (the product's whole vocabulary)

Every verdict is **color + glyph + label**. Never ship the color alone.

| Verdict | Glyph (Lucide) | Dark-mode text | Light-mode text | Fill / accent |
|---------|----------------|----------------|-----------------|---------------|
| `safe` | `shield-check` | `#4ADE80` | `#15803D` | `#22C55E` |
| `caution` | `alert-triangle` | `#FBBF24` | `#B45309` | `#F59E0B` |
| `danger` | `octagon-alert` | `#F87171` | `#B91C1C` | `#EF4444` |
| `unknown` | `circle-help` | `#94A3B8` | `#475569` | `#64748B` |
| `checking` | `loader-circle` | `#94A3B8` | `#475569` | `#64748B` |

Contrast verified against `#0F172A` (dark) and `#FFFFFF` (light), all ≥ 4.5:1 for text:

- `#4ADE80` on `#0F172A` ≈ 9.9:1 · `#15803D` on `#FFFFFF` ≈ 5.3:1
- `#FBBF24` on `#0F172A` ≈ 11.2:1 · `#B45309` on `#FFFFFF` ≈ 5.1:1
- `#F87171` on `#0F172A` ≈ 6.0:1 · `#B91C1C` on `#FFFFFF` ≈ 6.6:1
- `#94A3B8` on `#0F172A` ≈ 6.9:1 · `#475569` on `#FFFFFF` ≈ 7.5:1

**[adapted]** The raw palette had one `--color-destructive` and no caution/unknown tier, and its
`#EF4444` only reaches ~4.2:1 on `#0F172A` — below AA. Verdict ramps above are per-mode so both
themes pass. `#EF4444` survives as a **fill** color (borders, dots, icon fills), never as body text
on dark.

**Shape reinforcement** — so verdict survives greyscale and peripheral vision:
`safe` = pill, 1px border, no shadow · `caution` = pill, 1px border + left 3px bar ·
`danger` = pill, 2px border + left 3px bar + `--lv-shadow-md`.

### Anti-patterns

- ❌ AI purple/pink gradients (generator flag — and a security tool that looks like a toy isn't trusted)
- ❌ Red/green as the only difference between two states
- ❌ Any color inherited from the host page inside the badge
- ❌ Body text under 4.5:1 in either theme

---

## 2. Typography

- **Family:** `Inter` → system fallback.
- **[adapted] No `@import` from `fonts.googleapis.com`.** MV3's `extension_pages` CSP is
  `script-src 'self'; object-src 'self'` and golden rule 1 forbids loading anything remote at
  runtime. A CDN font is a remote resource *and* a per-open ping to Google. Inter ships in the
  package (`assets/fonts/`, Phase 5) or we fall through to the system stack.

```css
--lv-font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                "Helvetica Neue", Arial, sans-serif;
--lv-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
```

Hosts and URLs render in `--lv-font-mono` — a monospace host makes `paypa1.com` visually separable
from `paypal.com`, which is the entire point of the `typosquat` check.

### Scale

**[adapted]** Generator style was *Exaggerated Minimalism* — `clamp(3rem, 10vw, 12rem)`,
`font-weight: 900`, "massive whitespace". That's editorial/agency sizing. Our widest surface is a
360px popup and our most important one is a ~240px badge floating over foreign content. Replaced
with a compact utility scale. The *spirit* kept from that style — high contrast, generous negative
space, one bold focal element per view — carries over; the literal sizes do not.

| Token | Size / line-height | Weight | Use |
|-------|--------------------|--------|-----|
| `--lv-text-verdict` | 15px / 1.2 | 650 | Badge verdict word ("Danger") |
| `--lv-text-host` | 12px / 1.35 | 500 | Host string (mono, `--lv-font-mono`) |
| `--lv-text-reason` | 12px / 1.45 | 400 | "Why" lines |
| `--lv-text-title` | 16px / 1.3 | 600 | Popup / options headings |
| `--lv-text-body` | 14px / 1.5 | 400 | Popup / options body |
| `--lv-text-label` | 11px / 1.4 | 500 | Overlines, meta, counts |

Floor is 11px and only for non-essential meta — no body text below 12px.
Letter-spacing: `-0.01em` at 15px+, `0` below.

---

## 3. Spacing, radius, elevation

*Density 6/10 — standard, slightly tightened for extension chrome.*

| Token | Value | Use |
|-------|-------|-----|
| `--lv-space-xs` | 4px | Icon↔label gap |
| `--lv-space-sm` | 8px | Inline spacing, badge padding-y |
| `--lv-space-md` | 12px | Badge padding-x, list row padding |
| `--lv-space-lg` | 16px | Popup section padding |
| `--lv-space-xl` | 24px | Options section gap |
| `--lv-space-2xl` | 32px | Options page margin |

**[adapted]** Dropped the generator's `--space-3xl: 64px` "hero padding" — no surface here is tall
enough to use it.

| Token | Value |
|-------|-------|
| `--lv-radius-sm` | 6px |
| `--lv-radius-md` | 8px |
| `--lv-radius-lg` | 12px |
| `--lv-radius-pill` | 999px |

| Token | Value |
|-------|-------|
| `--lv-shadow-sm` | `0 1px 2px rgba(0,0,0,.28)` |
| `--lv-shadow-md` | `0 4px 12px rgba(0,0,0,.35)` |
| `--lv-shadow-lg` | `0 10px 28px rgba(0,0,0,.42)` |

**[adapted]** Generator shadows (`rgba(0,0,0,0.05)`–`0.15`) assume a white page. The badge floats
over arbitrary — often dark — backgrounds, so alphas are raised to keep it detached from whatever
is behind it.

---

## 4. Surface patterns

**[adapted]** Generator pattern was *Trust & Authority + Conversion* — hero → proof logos →
pricing → "Contact Sales". There is no page to convert on. Replaced with the three real surfaces:

### 4.1 Hover badge (content script · shadow DOM · vanilla)

```
   ┌────────────────────────────────────┐
   │ ⛉  DANGER                          │  ← eyebrow: glyph + 10px caps label
   │ example.com.secure-billing.invalid │  ← host, mono — OWNER at full weight,
   │ "example" is only a prefix here…   │     everything before it dimmed to 50%
   └────────────────────────────────────┘
```

**Severity is carried by the surface, not by extra strokes. [adapted]**

| verdict | surface | border | ink |
|---|---|---|---|
| `safe` | base | hairline neutral | jade |
| `unknown` / `checking` / `inertlink` | base | hairline neutral | slate |
| `caution` | base + accent @ 12% | accent @ 38% | amber |
| `danger` | **solid accent fill** | none | near-black (dark) / white (light) |

**`inertlink` — "InertLink" — is not a verdict.** It is the answer for an anchor that points at
nothing: `href="#"`, `javascript:void(0)`, `javascript:;`. It renders with the neutral slate ink, a
link-slash glyph, no host line, and the reason "This control is handled by the page — it does not
open a link". It is deliberately **not** counted in the per-tab tally, because it says nothing
about safety.

It exists because silence there was worse than either alternative. Such an anchor presents itself
as a link — pointer cursor, a URL in the browser's status bar — so showing nothing reads as the
extension being broken, while showing `danger` (which is what shipped) put a red badge on fourteen
controls of a single legitimate Amazon page. A plain `<button>` makes no claim to be a link and
still gets no badge at all (ADR-0016).

A quiet → tinted → solid ladder. It reads in peripheral vision, survives greyscale (the fills
differ in lightness, not just hue), and spends all of its boldness on the one state that has earned
it. Danger is roughly 1% of hovers; it is allowed to be loud. Nothing else is.

**Removed: the 3px left verdict bar, the full accent outline on danger, and the outer accent ring.**
All three encoded severity a second, third, and fourth time on top of the glyph and the colour,
and on danger they stacked into something that read as a form-validation error rather than a
warning. One signal, one encoding.

**The host is the hero, and the owner is emphasised inside it.** This is the badge's signature and
the reason it beats a plain colour chip: in `example.com.secure-billing.invalid` the registrable
domain — the part that says who actually owns this — renders at full weight while the deceptive
prefix drops to 50%. The badge does not just grade the link, it shows you where to look. The
verdict word shrinks to a 10px caps eyebrow, because by the time you read it you already know the
answer from the surface.

- Max width 300px. Host truncates in the **middle** (`payp…evil.ru`) — the TLD is the tell, so
  never clip the end.
- Host is mono. Not decoration: `rn` / `m` and `1` / `l` are the whole attack, and a monospace face
  separates them where a proportional one blurs them.
- One silhouette, always: 10px radius. Shape previously changed with the presence of a reason line,
  which made it look like severity when it wasn't.
- One reason line on the badge. Everything else lives in the details panel.
- Anchors to the cursor, offset 14px down-right; flips to stay in viewport; **never covers the link
  it describes** (PLAN.md §1).
- `pointer-events: none` always. Zero focus stealing, zero click interception.
- Top layer (`popover`) + `z-index` on the host, so no page can paint over it (ADR-0013).
- Shadow root opens with `all: initial` + explicit tokens so host CSS can't reach in.

### 4.2 Popup (360px wide, React + Framer Motion)

Order — status first, controls second, evidence third:

1. **Master toggle + current verdict for this tab** (the one bold focal element).
2. **This site**: host, pause-on-this-site switch, allowlist shortcut.
3. **Session counts**: safe / caution / danger checked. Numeric + colored, never color-only.
4. Footer: link to options, engine state (local-only vs. API enabled).

### 4.3 Options (React + Framer Motion)

Sectioned form, progressive disclosure (Priority 8): Sensitivity → Allowlist → Blocklist →
Online checks (off by default) → API key (revealed only when online checks are on) → Cache.
Labels always visible; errors inline next to their field, never batched at the top.

---

## 5. Motion

**[adapted]** Generator returned a GSAP *Stagger List* preset with `back.out(1.4)`. Two problems:
GSAP isn't in this project (Framer Motion is), and its own note says *"Don't use back.out on dense
data tables; the overshoot reads as sloppy on informational UI."* A safety verdict is informational
UI at its most serious — an overshoot on a `danger` badge reads as playful. Translated to Framer
Motion with non-overshooting springs; the stagger idea is kept for the options list.

**Where each library runs** (see `docs/DECISIONS.md` ADR-0002):

| Surface | Tech | Why |
|---------|------|-----|
| Badge | CSS transition + WAAPI | Injected into every page — must stay bytes-cheap and dependency-free |
| Popup / Options | Framer Motion | Extension pages, bundled, loaded on demand |

### Tokens

```css
--lv-dur-fast: 120ms;   /* exits */
--lv-dur-base: 180ms;   /* enters */
--lv-dur-slow: 260ms;   /* panel expand */
--lv-ease-out: cubic-bezier(.16, 1, .3, 1);
--lv-ease-in:  cubic-bezier(.4, 0, 1, 1);
```

Exits are faster than enters (Priority 7: `exit-faster-than-enter`). Enter `ease-out`, exit `ease-in`.

### Badge enter/exit (vanilla)

```
enter: opacity 0→1, translateY 4px→0, scale .96→1   180ms --lv-ease-out
exit:  opacity 1→0, scale 1→.98                     120ms --lv-ease-in
```

Transform + opacity only — never `width`/`height`/`top`/`left` (Priority 7 anti-pattern; also keeps
the badge off the host page's layout path).

### Framer Motion presets (popup / options)

```js
// Non-overshooting spring. The generator's back.out(1.4) equivalent would overshoot;
// a safety verdict must not bounce.
export const springSoft = { type: "spring", stiffness: 420, damping: 38, mass: 0.7 };

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: springSoft },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.12, ease: [.4, 0, 1, 1] } },
};

// Stagger kept from the generator preset, retimed and de-overshot.
export const listStagger = {
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
```

### Reduced motion (mandatory — Priority 1 & 7, severity High)

`prefers-reduced-motion: reduce` → opacity-only crossfade at `--lv-dur-fast`, no transform, no
spring, no stagger. In React this is `useReducedMotion()` from Framer Motion gating every variant;
in the badge it's a `@media` block inside the shadow root. A user who asks for less motion still
gets the full verdict — reduced motion never reduces information.

### Never animate

The verdict's **color or glyph**. A badge that morphs green→red mid-hover is a safety signal the
user can't trust. `checking` → resolved is a crossfade between two distinct elements, not a
morph of one.

---

## 6. Iconography

SVG only, **Lucide**, single set, `stroke-width: 2`, 16px in badge / 18px in popup.
No emoji as icons — ever (Priority 4). Icons ship inline in the package; no icon CDN, no icon font.
Every icon-only control carries an `aria-label`.

---

## 7. Pre-delivery checklist

Base checklist from the generator, plus extension-specific rows (marked ★):

- [ ] No emoji used as icons; all icons Lucide SVG, one set
- [ ] `cursor: pointer` on every clickable element
- [ ] Hover/state transitions 150–300ms, none instant
- [ ] Text contrast ≥ 4.5:1 in **both** light and dark
- [ ] Focus states visible for keyboard nav (`--lv-color-ring`, ≥3:1, never `outline: none` alone)
- [ ] `prefers-reduced-motion` respected on every animated surface
- [ ] Verdict readable in greyscale (glyph + shape, not color alone) ★
- [ ] Badge has `pointer-events: none` and never covers its own link ★
- [ ] Badge renders identically over a white page and a black page ★
- [ ] No host-page CSS leaks into the shadow root; no LinkVerify CSS leaks out ★
- [ ] Zero remote resources — no CDN font, script, or image ★
- [ ] Popup usable at 360×600 without scroll for the default state ★
