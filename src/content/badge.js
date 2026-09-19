/**
 * The hover badge. Renders a verdict next to the cursor, over someone else's page.
 *
 * Design contract (design-system/linkverify/MASTER.md §4.1) and golden rule 7:
 *   • shadow DOM + `all: initial` — host CSS can't reach in, our CSS can't leak out
 *   • `pointer-events: none` — never intercepts a click, never steals focus
 *   • never covers the link it describes; flips to stay inside the viewport
 *   • verdict = color + glyph + shape, so it survives greyscale and color-blindness
 *   • transform/opacity only; exits faster than enters; honours prefers-reduced-motion
 *
 * Deliberately vanilla — no React, no Framer Motion. This file is injected into every page the
 * user grants, so its cost is paid on every site they visit (ADR-0002).
 *
 * PHASE 0 — rendering and motion are real and reviewable. Nothing calls it yet; hover.js wires
 * it to the engine in Phase 2.
 */

const HOST_ID = 'linkverify-badge-root';
const OFFSET_X = 14;
const OFFSET_Y = 18;
const MAX_WIDTH = 280;

/** Lucide glyphs, inlined. No icon font, no CDN (golden rule 1). */
const GLYPHS = {
  safe: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  caution:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  danger:
    '<path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  unknown:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  checking: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/>',
  // Link-slash: it looks like a link, but it isn't one.
  inertlink:
    '<path d="M17 7h.35a5 5 0 0 1 3.5 8.55"/><path d="M8 7h-.35a5 5 0 0 0-3.53 8.53"/><path d="M8 12h3"/><path d="m2 2 20 20"/>',
};

const LABELS = {
  safe: 'Safe',
  caution: 'Caution',
  danger: 'Danger',
  unknown: 'Unverified',
  checking: 'Checking…',
  inertlink: 'InertLink',
};

/**
 * Tokens are inlined rather than linked. A <link> from a content script is a fetch the host page
 * can observe, and a cascade it can fight with. This subset mirrors src/shared/tokens.css.
 */
const STYLE = `
  :host { all: initial; }

  .lv-badge {
    position: fixed;
    z-index: 2147483647;
    top: 0; left: 0;
    pointer-events: none;           /* golden rule 7 — never intercept a click */
    will-change: transform, opacity;

    display: flex;
    flex-direction: column;
    gap: 3px;

    max-width: ${MAX_WIDTH}px;
    padding: 9px 12px 10px;
    /* One silhouette, always. Radius used to change with the presence of a reason line, which
       looked like it meant something and didn't (MASTER.md §4.1). */
    border-radius: 10px;
    border: 1px solid var(--lv-edge);
    background: var(--lv-surface);
    color: var(--lv-fg);
    box-shadow: 0 6px 20px -6px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.3);

    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.35;
    text-align: left;
    direction: ltr;

    opacity: 0;
    transform: translate3d(0, 0, 0);
  }

  /* ── Severity ladder: quiet → tinted → solid ────────────────────────────────
     Carried by the surface, so it reads in peripheral vision and in greyscale.
     No extra bars, outlines, or rings — those said the same thing three more times. */
  .lv-badge[data-verdict="caution"] {
    --lv-surface: var(--lv-tint);
    --lv-edge: var(--lv-edge-accent);
  }
  .lv-badge[data-verdict="danger"] {
    --lv-surface: var(--lv-accent-fill);
    --lv-edge: transparent;
    --lv-fg: var(--lv-on-fill);
    --lv-fg-muted: var(--lv-on-fill-muted);
    --lv-accent: var(--lv-on-fill);
    box-shadow: 0 8px 24px -6px var(--lv-danger-glow), 0 1px 2px rgba(0,0,0,.35);
  }

  /* ── Eyebrow: glyph + verdict word ──────────────────────────────────────────
     The word is small because by the time you read it, the surface has already told you.
     It stays because colour alone must never be the only encoding. */
  .lv-eyebrow {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--lv-accent);
  }
  .lv-icon { width: 13px; height: 13px; flex: none; }
  .lv-icon svg { width: 100%; height: 100%; display: block; fill: none; stroke: currentColor;
                 stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
  .lv-verdict {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .09em;
    text-transform: uppercase;
  }

  /* ── Host: the hero. The owner is what you need to read, so it is what is legible.
     Mono is load-bearing, not styling: rn/m and 1/l are the attack (MASTER.md §4.1). ── */
  .lv-host {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: -.01em;
    color: var(--lv-fg-muted);
    word-break: break-all;
  }
  /* The registrable domain — who actually owns this — at full contrast and weight.
     Everything before it is a prefix anyone can register, and drops back. */
  .lv-owner { color: var(--lv-fg); font-weight: 600; }

  .lv-reason { font-size: 11.5px; color: var(--lv-fg-muted); }
  .lv-hidden { display: none; }

  /* checking: the only motion that loops, and it stops the moment a verdict lands. */
  .lv-badge[data-verdict="checking"] .lv-icon { animation: lv-spin 900ms linear infinite; }
  @keyframes lv-spin { to { transform: rotate(360deg); } }

  /* Dark is the default; light follows the user, not the page. */
  .lv-badge {
    --lv-surface: #12151c;
    --lv-fg: #f4f6fa;
    --lv-fg-muted: #98a3b5;
    --lv-edge: #262c38;
    --lv-on-fill: #180604;
    --lv-on-fill-muted: rgba(24,6,4,.72);
    --lv-danger-glow: rgba(224,65,44,.45);
  }
  .lv-badge[data-verdict="safe"] { --lv-accent: #5bd6a4; }
  .lv-badge[data-verdict="caution"] {
    --lv-accent: #f2b441;
    --lv-tint: #1e1a12;
    --lv-edge-accent: #4a3a1a;
  }
  .lv-badge[data-verdict="danger"] { --lv-accent-fill: #e0412c; }
  .lv-badge[data-verdict="unknown"],
  .lv-badge[data-verdict="inertlink"],
  .lv-badge[data-verdict="checking"] { --lv-accent: #93a0b4; }

  @media (prefers-color-scheme: light) {
    .lv-badge {
      --lv-surface: #ffffff;
      --lv-fg: #0d1117;
      --lv-fg-muted: #5b6673;
      --lv-edge: #e3e7ec;
      --lv-on-fill: #ffffff;
      --lv-on-fill-muted: rgba(255,255,255,.82);
      --lv-danger-glow: rgba(192,39,26,.32);
      box-shadow: 0 6px 20px -8px rgba(13,17,23,.25), 0 1px 2px rgba(13,17,23,.08);
    }
    .lv-badge[data-verdict="safe"] { --lv-accent: #0f7a55; }
    .lv-badge[data-verdict="caution"] {
      --lv-accent: #8a5206;
      --lv-tint: #fdf6e7;
      --lv-edge-accent: #e8d3a3;
    }
    .lv-badge[data-verdict="danger"] { --lv-accent-fill: #c0271a; }
    .lv-badge[data-verdict="unknown"],
    .lv-badge[data-verdict="inertlink"],
    .lv-badge[data-verdict="checking"] { --lv-accent: #4a5565; }
  }

  @media (prefers-reduced-motion: reduce) {
    .lv-badge[data-verdict="checking"] .lv-icon { animation: none; }
  }
`;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = null; // { host, root, el, nodes, anim }

/**
 * Put the host in the top layer, once it is connected.
 *
 * Wrapped because `showPopover()` throws if the element is already open or not connected, and a
 * throw here would take the badge down on a page that is otherwise fine (golden rule 6). Failure
 * is survivable: the host's `z-index: 2147483647` still beats every ordinary page.
 */
function showInTopLayer(host) {
  try {
    if (host.isConnected && host.popover && !host.matches(':popover-open')) host.showPopover();
  } catch {
    /* not supported, or already open */
  }
}

function mount() {
  if (state) return state;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // The host element is inert too, so even a mis-timed click lands on the page beneath.
  //
  // `z-index` belongs HERE, on the host, not only on `.lv-badge` inside the shadow root. A
  // `position: fixed` element always creates a stacking context, so the badge's
  // z-index:2147483647 is scoped *inside* the host and competes with nothing on the page. The
  // host's own level is what matters — and with `all: initial` that was `auto`, which any
  // positioned page element with `z-index: 1` or more paints over. A site nav at `z-index: 100`
  // was enough to swallow the badge whole.
  host.style.cssText =
    'all:initial;position:fixed;top:0;left:0;width:0;height:0;' +
    'pointer-events:none;z-index:2147483647;border:0;padding:0;margin:0;' +
    'background:transparent;overflow:visible;';

  // Belt and braces: the top layer is above every z-index on the page, and is not clipped by an
  // ancestor's overflow or transform either. `manual` means it never light-dismisses, and the
  // popover box itself is neutralised by the inline styles above.
  try {
    host.popover = 'manual';
  } catch {
    // Pre-Chrome-114. The z-index above still covers every ordinary page.
  }

  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;

  const el = document.createElement('div');
  el.className = 'lv-badge';
  el.setAttribute('data-verdict', 'unknown');
  // Announced, not focused: the badge must never pull focus off the link (golden rule 7).
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <span class="lv-eyebrow">
      <span class="lv-icon" aria-hidden="true"></span>
      <span class="lv-verdict"></span>
    </span>
    <span class="lv-host"><span class="lv-prefix"></span><span class="lv-owner"></span></span>
    <span class="lv-reason"></span>
  `;

  root.append(style, el);
  (document.body ?? document.documentElement).appendChild(host);
  showInTopLayer(host);

  state = {
    host,
    root,
    el,
    nodes: {
      icon: el.querySelector('.lv-icon'),
      verdict: el.querySelector('.lv-verdict'),
      host: el.querySelector('.lv-host'),
      prefix: el.querySelector('.lv-prefix'),
      owner: el.querySelector('.lv-owner'),
      reason: el.querySelector('.lv-reason'),
    },
    anim: null,
  };
  return state;
}

/**
 * Keep the badge inside the viewport and off the link it describes.
 * Below-right of the cursor by default; flips axis-by-axis when it would overflow.
 */
function position(el, x, y) {
  const { width, height } = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = x + OFFSET_X;
  let top = y + OFFSET_Y;

  if (left + width > vw - 8) left = Math.max(8, x - OFFSET_X - width);
  // Flipping above the cursor also means flipping above the link — it never sits on top of it.
  if (top + height > vh - 8) top = Math.max(8, y - OFFSET_Y - height);

  el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

/**
 * Split a display host into `[prefix, owner]`, where owner is the registrable domain.
 *
 * `example.com.secure-billing.invalid` → `['example.com.', 'secure-billing.invalid']`. The badge
 * dims the prefix and bolds the owner, which is the one piece of information that resolves a
 * deceptive-subdomain link at a glance.
 *
 * Falls back to treating the whole string as the owner — never the reverse. If we are unsure which
 * part is the real domain, emphasising the wrong half would point the user at the attacker's text.
 */
function splitHost(host, registrable) {
  if (!host) return ['', ''];
  if (!registrable || registrable === host) return ['', host];
  // The host was middle-truncated for display, so the owner may no longer be a literal suffix.
  if (!host.endsWith(registrable)) return ['', host];
  return [host.slice(0, host.length - registrable.length), registrable];
}

/**
 * Show or update the badge.
 *
 * @param {Object}  detail
 * @param {'safe'|'caution'|'danger'|'unknown'|'checking'} detail.verdict
 * @param {string}  detail.host        Already display-truncated by the caller.
 * @param {string} [detail.registrable] eTLD+1, emphasised inside the host.
 * @param {string} [detail.reason]     Single strongest reason.
 * @param {number}  detail.x           Cursor viewport X.
 * @param {number}  detail.y           Cursor viewport Y.
 */
export function showBadge({
  verdict = 'unknown',
  host = '',
  registrable = '',
  reason = '',
  x = 0,
  y = 0,
}) {
  const s = mount();
  // Re-assert every time: a single-page app that rewrites document.body can drop us out of the
  // top layer (or out of the document) without any error we would otherwise see.
  if (!s.host.isConnected) (document.body ?? document.documentElement).appendChild(s.host);
  showInTopLayer(s.host);

  const wasVisible = s.el.dataset.visible === 'true';

  s.el.dataset.verdict = verdict;
  s.nodes.icon.innerHTML = `<svg viewBox="0 0 24 24">${GLYPHS[verdict] ?? GLYPHS.unknown}</svg>`;
  s.nodes.verdict.textContent = LABELS[verdict] ?? LABELS.unknown;

  // Split the host so the registrable domain reads as the answer and the prefix reads as noise.
  // `textContent` on both halves, never innerHTML — the host string is attacker-controlled.
  const [prefix, owner] = splitHost(host, registrable);
  s.nodes.prefix.textContent = prefix;
  s.nodes.owner.textContent = owner;
  s.nodes.host.classList.toggle('lv-hidden', !host);

  s.nodes.reason.textContent = reason;
  s.nodes.reason.classList.toggle('lv-hidden', !reason);

  position(s.el, x, y);
  s.el.dataset.visible = 'true';

  s.anim?.cancel();
  if (wasVisible) {
    // Already on screen: don't re-animate, just keep it pinned to the cursor.
    s.el.style.opacity = '1';
    return;
  }

  // Enter rises from the cursor — the motion says where the badge came from.
  const reduced = prefersReducedMotion();
  const from = reduced
    ? { opacity: 0 }
    : { opacity: 0, transform: `${s.el.style.transform} translateY(4px) scale(.96)` };
  const to = reduced ? { opacity: 1 } : { opacity: 1, transform: s.el.style.transform };

  s.anim = s.el.animate([from, to], {
    duration: reduced ? 1 : 180,
    easing: 'cubic-bezier(.16, 1, .3, 1)',
    fill: 'forwards',
  });
}

/** Move an already-visible badge without re-running the enter animation. */
export function moveBadge(x, y) {
  if (!state || state.el.dataset.visible !== 'true') return;
  position(state.el, x, y);
}

/** Hide the badge. Exits faster than it entered. */
export function hideBadge() {
  if (!state || state.el.dataset.visible !== 'true') return;
  const s = state;
  s.el.dataset.visible = 'false';
  s.anim?.cancel();

  const reduced = prefersReducedMotion();
  s.anim = s.el.animate(
    [
      { opacity: 1 },
      reduced ? { opacity: 0 } : { opacity: 0, transform: `${s.el.style.transform} scale(.98)` },
    ],
    { duration: reduced ? 1 : 120, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }
  );
}

/** Remove the badge from the page entirely. Called on teardown / per-site pause. */
export function destroyBadge() {
  state?.host.remove();
  state = null;
}
