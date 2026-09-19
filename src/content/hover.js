/**
 * Hover orchestration: one delegated listener → nearest <a> → engine → badge.
 *
 * Constraints this file exists to honour:
 *   • ONE delegated mouseover/mouseout listener on document, never per-<a> listeners
 *   • ~250ms dwell debounce before any verdict work (PLAN.md §1)
 *   • hovering must never fetch the destination (golden rule 3) — we read the href string
 *   • every handler wrapped: a throw here must not break the host page (golden rule 6)
 *   • memoize per-href so re-entering the same link is free
 *
 * Deliberately vanilla and dependency-free. This runs on every page the user grants (ADR-0002).
 */

import { evaluate, primaryReason, truncateHost } from '../engine/index.js';
import { isInertLinkHref } from '../engine/parse.js';
import { showBadge, moveBadge, hideBadge, destroyBadge } from './badge.js';
import { MSG, VERDICT, VERDICT_RANK, checkUrl, sendSafe } from '../shared/messages.js';
import { DEFAULT_SETTINGS, readSettings, onSettingsChanged } from '../shared/settings.js';

export const DWELL_MS = 250;

/** Verdict cache keyed by href, per page. Bounded so a link-heavy page can't grow it forever. */
const MEMO_LIMIT = 400;

let settings = { ...DEFAULT_SETTINGS };
let unsubscribeSettings = null;
let running = false;
/** Hosts fetched by the worker's refresh alarm. Empty unless the user configured a feed. */
let remoteBlocklist = [];

/** Session tally, in memory only. Dies with the tab — this is not browsing history. */
const counts = { safe: 0, caution: 0, danger: 0, unknown: 0 };

const memo = new Map();
let dwellTimer = null;
let rafId = null;
/** The anchor currently under the cursor; `null` between links. */
let activeAnchor = null;
/** Monotonic id so a slow Layer-2 answer can't paint over a newer hover. */
let hoverSeq = 0;
const cursor = { x: 0, y: 0 };

const isPaused = () =>
  !settings.enabled || settings.pausedHosts.some((h) => h === location.hostname);

/**
 * What will this element take me to, if I click it?
 *
 * An `<a href>` is the obvious case, but it is not the only way a click navigates. Amazon's cart
 * "Delete" and "Save for later" are `<input type="submit">` inside a `<form method="post">` — a
 * click leaves the page exactly like a link does, and we were silent on them. Phishing kits POST
 * credentials to attacker endpoints through the same mechanism, so a submit control's destination
 * is squarely the question this product exists to answer.
 *
 * (This is not the credential-field warning parked in CLAUDE.md §7. That is about flagging input
 * fields; this is about where a click goes, which is the core mission.)
 *
 * Reading `action` / `formaction` is string inspection. Nothing is submitted, nothing is fetched
 * (golden rule 3).
 *
 * @returns {{ el: Element, url: string, text: string }|null}
 */
function targetFrom(target) {
  if (!(target instanceof Element)) return null;

  const a = target.closest('a[href]');
  if (a) {
    const href = a.getAttribute('href');
    // `#` and `javascript:void(0)` go nowhere — Amazon's "Share" is the former, and its menus are
    // the latter. We still answer, because the anchor *presents itself as a link*: it has a
    // pointer cursor and Chrome prints a URL in the status bar. Staying silent there is
    // indistinguishable from the extension being broken, which is exactly how it was read.
    // A plain <button> makes no such claim, so it gets no badge (below).
    if (isInertLinkHref(href)) return { el: a, url: '', text: '', inertLink: true };
    return { el: a, url: a.href || href, text: anchorText(a) };
  }

  const submit = target.closest('button, input[type="submit"], input[type="image"]');
  if (!submit) return null;

  // A <button> with no type defaults to submit; type="button" and type="reset" navigate nowhere.
  const type = (submit.getAttribute('type') ?? (submit.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
  if (type !== 'submit' && type !== 'image') return null;

  const form = submit.form ?? submit.closest('form');
  if (!form) return null;

  const action = submit.getAttribute('formaction') || form.getAttribute('action');
  let resolved;
  try {
    resolved = new URL(action || location.href, location.href);
  } catch {
    return null;
  }

  // A form that posts back to the page you are already on tells you nothing worth a badge.
  if (!action || resolved.href === location.href) return null;

  return { el: submit, url: resolved.href, text: '' };
}

/**
 * Anchor text, capped. We read `textContent`, never `innerHTML`, and never anything from the
 * page's JS — the content script must not become a way to exfiltrate page contents.
 */
function anchorText(a) {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 200);
  // <a><img alt="…"></a> — the alt text is the visible claim.
  const img = a.querySelector('img[alt]');
  return (img?.getAttribute('alt') ?? '').slice(0, 200);
}

function engineContext(text) {
  return {
    anchorText: text,
    pageHost: location.hostname,
    pageUrl: location.href,
    sensitivity: settings.sensitivity,
    userAllowlist: settings.allowlist,
    userBlocklist: settings.blocklist,
    remoteBlocklist,
  };
}

function remember(key, value) {
  if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value);
  memo.set(key, value);
  return value;
}

function paint(result, { pending = false } = {}) {
  showBadge({
    verdict: pending ? VERDICT.CHECKING : result.verdict,
    host: truncateHost(result.parsed?.host ?? '', 34),
    // The badge emphasises this inside the host: it is the answer to "who owns this link?"
    registrable: result.parsed?.registrable ?? '',
    reason: pending ? '' : primaryReason(result),
    x: cursor.x,
    y: cursor.y,
  });
}

/**
 * Ask the worker for a second opinion, and only for a host we have already decided is genuinely
 * ambiguous. Everything about this path is gated (PLAN.md §2, golden rule 2):
 *   • the user must have turned online checks on — it ships off
 *   • the local verdict must be borderline
 *   • the host must not be allowlisted (`suppressNetwork`)
 * The worker sends the **host** onward, never the URL. We pass the URL only so the worker can
 * re-evaluate locally; it does not leave the device.
 */
async function confirm(result, seq, href) {
  if (!settings.onlineChecks) return;
  if (!result.borderline || result.suppressNetwork) return;
  const host = result.parsed?.host;
  if (!host) return;

  paint(result, { pending: true });

  const reply = await sendSafe(
    checkUrl({ host, url: result.parsed.raw, localScore: result.score })
  );

  // The cursor moved on while we waited — a stale answer must never paint (PLAN.md §6).
  if (seq !== hoverSeq || !activeAnchor) return;

  if (reply?.type !== MSG.CHECK_RESULT || !reply.verdict || reply.verdict === VERDICT.UNKNOWN) {
    // Provider down, no key, or nothing known: fall back to the local verdict (golden rule 6).
    paint(result);
    return;
  }

  // Take the *worse* of the two. A provider saying "clean" does not erase a local signal it
  // never saw, like an anchor whose text lies about its destination.
  const merged =
    VERDICT_RANK[reply.verdict] > VERDICT_RANK[result.verdict]
      ? {
          ...result,
          verdict: reply.verdict,
          signals: [
            { id: 'reputation', hit: true, weight: 0, reason: reply.reasons?.[0] ?? 'Reported as unsafe' },
            ...result.signals,
          ],
        }
      : result;

  remember(href, merged);
  tally(merged.verdict, result.verdict);
  paint(merged);
}

function tally(verdict, previous) {
  if (previous && previous in counts) counts[previous] = Math.max(0, counts[previous] - 1);
  if (verdict in counts) counts[verdict] += 1;
}

function resolve(target) {
  const seq = hoverSeq;

  // An InertLink gets a plain answer rather than a verdict. It is not safe, not risky, and not
  // "unverified" — there is simply nothing at the other end, and saying so is more useful than
  // saying nothing. Not tallied: it is not a judgement about safety.
  if (target.inertLink) {
    showBadge({
      verdict: 'inertlink',
      host: '',
      reason: 'This control is handled by the page — it does not open a link',
      x: cursor.x,
      y: cursor.y,
    });
    return;
  }

  const href = target.url;

  const cached = memo.get(href);
  if (cached) {
    paint(cached);
    return;
  }

  const result = evaluate(href, engineContext(target.text));
  remember(href, result);
  tally(result.verdict);
  paint(result);

  // Fire-and-forget: the badge is already correct without it.
  confirm(result, seq, href).catch(() => {});
}

/* ── listeners ─────────────────────────────────────────────────────────────────────────────── */

function onMouseOver(event) {
  // Paused means paused: no evaluation, no badge, no work at all on this page.
  if (isPaused()) return;

  const target = targetFrom(event.target);
  if (!target || target.el === activeAnchor) return;

  activeAnchor = target.el;
  hoverSeq += 1;
  cursor.x = event.clientX;
  cursor.y = event.clientY;

  clearTimeout(dwellTimer);
  // The dwell is the privacy feature as much as the performance one: a cursor crossing a page
  // full of links must not evaluate — let alone look up — every one it passes over.
  dwellTimer = setTimeout(() => {
    if (activeAnchor === target.el) resolve(target);
  }, DWELL_MS);
}

function onMouseOut(event) {
  if (!activeAnchor) return;
  // Moving between children of the same anchor is not leaving it.
  const to = event.relatedTarget;
  if (to instanceof Element && activeAnchor.contains(to)) return;

  activeAnchor = null;
  hoverSeq += 1;
  clearTimeout(dwellTimer);
  hideBadge();
}

function onMouseMove(event) {
  cursor.x = event.clientX;
  cursor.y = event.clientY;
  if (!activeAnchor || rafId) return;
  // Position updates ride the frame, not the event — mousemove fires far faster than paint.
  rafId = requestAnimationFrame(() => {
    rafId = null;
    moveBadge(cursor.x, cursor.y);
  });
}

/** Scrolling moves the link out from under a fixed-position badge. Cheapest fix: drop it. */
function onScrollOrBlur() {
  if (!activeAnchor) return;
  activeAnchor = null;
  hoverSeq += 1;
  clearTimeout(dwellTimer);
  hideBadge();
}

/** Escape dismisses the badge without moving the mouse — keyboard users get an out too. */
function onKeyDown(event) {
  if (event.key === 'Escape') onScrollOrBlur();
}

/** Every handler is wrapped. A throw inside ours must never surface as an error on their page. */
function guard(fn) {
  return (event) => {
    try {
      fn(event);
    } catch {
      /* golden rule 6 */
    }
  };
}

const handlers = [
  ['mouseover', guard(onMouseOver), true],
  ['mouseout', guard(onMouseOut), true],
  ['mousemove', guard(onMouseMove), true],
  ['scroll', guard(onScrollOrBlur), true],
  ['blur', guard(onScrollOrBlur), true],
  ['keydown', guard(onKeyDown), true],
];

/** popup → content script. Answers what this tab has seen, so the popup shows real numbers. */
function onRuntimeMessage(message, _sender, sendResponse) {
  if (message?.type !== MSG.GET_TAB_STATE) return undefined;
  sendResponse({
    active: running && !isPaused(),
    paused: isPaused(),
    host: location.hostname,
    counts: { ...counts },
  });
  return undefined;
}

export async function start() {
  if (running) return;
  running = true;

  settings = await readSettings();

  // Read, never fetch. The worker owns the refresh; the content script only consumes what is
  // already on the device (golden rule 5 — no network from the page).
  try {
    const stored = await chrome.storage.local.get('lv:remote-blocklist');
    remoteBlocklist = stored?.['lv:remote-blocklist']?.hosts ?? [];
  } catch {
    remoteBlocklist = [];
  }

  // Settings change from the popup and options pages, in another context entirely. Re-reading on
  // change is what makes "sensitivity" or "pause this site" take effect without a page reload.
  unsubscribeSettings = onSettingsChanged((patch) => {
    settings = { ...settings, ...patch };
    memo.clear(); // thresholds moved — every cached verdict is now suspect
    if (isPaused()) hideBadge();
  });

  for (const [type, fn, capture] of handlers) {
    (type === 'blur' ? window : document).addEventListener(type, fn, {
      capture,
      passive: true,
    });
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
}

export function stop() {
  if (!running) return;
  running = false;

  clearTimeout(dwellTimer);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  activeAnchor = null;
  memo.clear();

  for (const [type, fn, capture] of handlers) {
    (type === 'blur' ? window : document).removeEventListener(type, fn, { capture });
  }
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  unsubscribeSettings?.();
  destroyBadge();
}
