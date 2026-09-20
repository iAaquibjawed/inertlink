/**
 * InertLink site.
 *
 * The important decision in this file: the demo imports the **extension's own** engine and badge.
 * `evaluate()` and `showBadge()` here are the same modules that ship in `dist/`, so the verdicts on
 * this page are computed, not written down, and the badge is the real component rather than a
 * recreation of it. A marketing page that lies about the product would be a strange thing to build
 * for a product whose entire pitch is that it doesn't lie about links.
 *
 * Motion is GSAP + ScrollTrigger, self-hosted through the bundle (no CDN, ADR-0004).
 */

import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { evaluate, primaryReason, truncateHost } from '../src/engine/index.js';
import { WEIGHTS, THRESHOLDS } from '../src/engine/scoring.js';
import { showBadge, hideBadge, moveBadge } from '../src/content/badge.js';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── Specimens ────────────────────────────────────────────────────────────────────────────
   Every hostname is RFC 2606 / RFC 5737 reserved, so nothing on this page can resolve — the
   same rule the extension's own fixtures follow. The verdict text is NOT authored here; it is
   whatever the engine returns. */

const SPECIMENS = [
  {
    label: 'looks like your bank',
    url: 'https://example.com.secure-billing.invalid/pay',
    anchorText: 'example.com billing',
  },
  {
    label: 'one letter pair swapped',
    url: 'https://exarnple.com/account',
    anchorText: 'example.com',
  },
  {
    label: 'the @ trick',
    url: 'https://example.com@internal.invalid/verify',
    anchorText: 'https://example.com/verify',
  },
  {
    label: 'shortened',
    url: 'https://example.test/x/aZ9',
    anchorText: 'Open document',
  },
  {
    label: 'sign-in over plain http',
    url: 'http://example.com/login',
    anchorText: 'Sign in',
  },
  {
    label: 'ordinary link',
    url: 'https://example.com/pricing',
    anchorText: 'Pricing',
  },
  {
    label: 'a menu, not a link',
    url: 'javascript:void(0)',
    anchorText: 'See more categories',
  },
  {
    label: 'known-safe domain',
    url: 'https://google.com/search?q=test',
    anchorText: 'Search',
  },
];

/** Split a host so the registrable domain reads as the answer — the badge's device, reused. */
function splitHost(host, registrable) {
  if (!host) return ['', ''];
  if (!registrable || registrable === host || !host.endsWith(registrable)) return ['', host];
  return [host.slice(0, host.length - registrable.length), registrable];
}

function buildSpecimens() {
  const root = $('#specimens');
  if (!root) return [];

  const cards = SPECIMENS.map((spec) => {
    const result = evaluate(spec.url, { anchorText: spec.anchorText });

    const card = document.createElement('a');
    card.className = 'specimen';
    // href="#" on purpose: nothing on this page should navigate. It also means the card is
    // itself an InertLink, which the extension would correctly report as going nowhere.
    card.href = '#';
    card.setAttribute('role', 'button');
    card.dataset.url = spec.url;

    const label = document.createElement('span');
    label.className = 'specimen__label';
    label.textContent = spec.label;

    const url = document.createElement('span');
    url.className = 'specimen__url';
    const host = result.parsed?.host ?? '';
    const [prefix, owner] = splitHost(host, result.parsed?.registrable ?? '');
    if (host) {
      url.append(document.createTextNode(`${result.parsed.scheme}//${prefix}`));
      const strong = document.createElement('span');
      strong.className = 'specimen__owner';
      strong.textContent = owner;
      url.append(strong, document.createTextNode(result.parsed.path ?? ''));
    } else {
      // No host at all — an InertLink or an unparseable href. Show it verbatim.
      url.textContent = spec.url;
    }

    const why = document.createElement('span');
    why.className = 'specimen__why';
    // Two different kinds of "no reason": a clean link that genuinely goes somewhere, and an
    // InertLink that goes nowhere at all. Collapsing them into one sentence told the visitor that
    // example.com/pricing leads nowhere, which is simply false.
    why.textContent =
      primaryReason(result) ||
      (result.parsed
        ? 'No signals fired. This is what a clean link looks like.'
        : 'Goes nowhere — the page handles this click itself.');

    card.append(label, url, why);
    card.addEventListener('click', (e) => e.preventDefault());

    return { el: card, spec, result };
  });

  root.append(...cards.map((c) => c.el));
  return cards;
}

/** Wire the real badge to hover, mirroring the extension's own dwell + cursor behaviour. */
function wireBadge(cards) {
  const DWELL = 250;
  let timer = null;
  let active = null;
  const cursor = { x: 0, y: 0 };

  const paint = (entry) => {
    const { result, spec } = entry;
    // An href that goes nowhere is an InertLink, not a verdict — same rule as the extension.
    if (!result.parsed) {
      showBadge({
        verdict: 'inertlink',
        host: '',
        reason: 'This control is handled by the page — it does not open a link',
        x: cursor.x,
        y: cursor.y,
      });
      return;
    }
    showBadge({
      verdict: result.verdict,
      host: truncateHost(result.parsed.host, 34),
      registrable: result.parsed.registrable,
      reason: primaryReason(result),
      x: cursor.x,
      y: cursor.y,
    });
    void spec;
  };

  for (const entry of cards) {
    entry.el.addEventListener('mouseenter', (e) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      active = entry;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active === entry) paint(entry);
      }, DWELL);
    });
    entry.el.addEventListener('mouseleave', () => {
      active = null;
      clearTimeout(timer);
      hideBadge();
    });
    // Keyboard parity: the badge must be reachable without a mouse.
    entry.el.addEventListener('focus', (e) => {
      const r = e.target.getBoundingClientRect();
      cursor.x = r.left + 24;
      cursor.y = r.top + r.height - 8;
      active = entry;
      paint(entry);
    });
    entry.el.addEventListener('blur', () => {
      active = null;
      hideBadge();
    });
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      if (active) moveBadge(cursor.x, cursor.y);
    },
    { passive: true }
  );

  window.addEventListener('scroll', () => {
    if (!active) return;
    active = null;
    clearTimeout(timer);
    hideBadge();
  });
}

/* ── Checks table, read from the engine's own weight map ──────────────────────────────── */

const CHECK_COPY = {
  typosquat: 'A domain one or two edits from a real brand. Folds lookalikes first: paypa1 → paypal.',
  'userinfo-trick': 'Everything before an @ is discarded by the browser. The real host is after it.',
  'deceptive-subdomain': 'The brand is only a prefix. Whoever owns the last two labels owns the link.',
  'text-href-mismatch': 'The visible text names one site and the href points at another.',
  'punycode-idn': 'Letters from another alphabet chosen because they look like English ones.',
  'ip-host': 'A bare IP address instead of a named site. Bypasses every domain reputation system.',
  'encoded-obfuscation': 'Heavy encoding, a nested second address, or a machine-generated hostname.',
  'url-shortener': 'The destination is hidden. We will not resolve it — that would be a request.',
  'suspicious-tld': 'Graded, not binary. `.zip` reads as a filename; cheap TLDs only add weight.',
  'excessive-subdomains': 'Levels of padding so the words you read have nothing to do with the owner.',
  'nonstandard-port': 'A sign-in page on an odd port. Real consumer services use 80 and 443.',
  'non-https': 'Unencrypted, or a scheme that runs code instead of opening a page.',
  'local-blocklist': 'A known-phishing host. Decisive on its own, and it outranks the allowlist.',
  allowlist: 'Known-safe or user-trusted. Short-circuits to safe and is never sent anywhere.',
};

/**
 * Bar colour by what the signal *means*, not by its magnitude.
 *
 * Keying on `Math.abs(weight)` painted `allowlist` (-100) in danger red — the one check that
 * exists to say "this is fine" rendered as the most dangerous thing on the page. Sign first,
 * then strength.
 */
function tintFor(weight) {
  if (weight < 0) return 'var(--safe)';
  if (weight >= 40) return 'var(--danger)';
  if (weight >= 20) return 'var(--caution)';
  return 'var(--unknown)';
}

function buildChecks() {
  const list = $('#checksList');
  if (!list) return;

  const entries = Object.entries(WEIGHTS).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const max = Math.max(...entries.map(([, w]) => Math.abs(w)));

  for (const [id, weight] of entries) {
    const li = document.createElement('li');
    li.className = 'check';

    const name = document.createElement('span');
    name.className = 'check__id';
    name.textContent = id;

    const w = document.createElement('span');
    w.className = 'check__weight';
    w.textContent = weight > 0 ? `+${weight}` : String(weight);

    const what = document.createElement('p');
    what.className = 'check__what';
    what.textContent = CHECK_COPY[id] ?? '';

    const bar = document.createElement('span');
    bar.className = 'check__bar';
    const fill = document.createElement('i');
    fill.className = 'check__fill';
    fill.style.setProperty('--tint', tintFor(weight));
    fill.dataset.pct = String(Math.round((Math.abs(weight) / max) * 100));
    bar.append(fill);

    li.append(name, w, what, bar);
    list.append(li);
  }
}

/* ── Score meter ──────────────────────────────────────────────────────────────────────── */

function wireMeter() {
  const range = $('#meterRange');
  const score = $('#meterScore');
  const verdict = $('#meterVerdict');
  if (!range || !score || !verdict) return;

  const band = THRESHOLDS.balanced;

  const render = (value) => {
    score.textContent = String(value);
    const v = value >= band.dangerAt ? 'danger' : value >= band.cautionAt ? 'caution' : 'safe';
    verdict.dataset.verdict = v;
    verdict.textContent = v === 'danger' ? 'Danger' : v === 'caution' ? 'Caution' : 'Safe';
  };

  range.addEventListener('input', () => render(Number(range.value)));
  render(Number(range.value));

  // Scrubbing the value on scroll-in demonstrates the ramp without the visitor having to find
  // the control. It stops the moment they touch it.
  if (REDUCED) {
    range.value = '46';
    render(46);
    return;
  }
  let userTouched = false;
  range.addEventListener('pointerdown', () => (userTouched = true));
  range.addEventListener('keydown', () => (userTouched = true));

  const proxy = { v: 0 };
  ScrollTrigger.create({
    trigger: '#meter',
    start: 'top 78%',
    once: true,
    onEnter: () =>
      gsap.to(proxy, {
        v: 46,
        duration: 2.4,
        ease: 'power2.inOut',
        onUpdate: () => {
          if (userTouched) return;
          const value = Math.round(proxy.v);
          range.value = String(value);
          render(value);
        },
      }),
  });
}

/* ── Motion ───────────────────────────────────────────────────────────────────────────── */

function heroChoreography() {
  const caret = $('#caret');
  const owner = $('#dissectOwner');

  if (REDUCED) {
    gsap.set('[data-anim]', { opacity: 1, y: 0 });
    gsap.set(caret, { opacity: 0 });
    return;
  }

  // Budget: the hero must be READABLE inside ~700ms. An earlier pass ran nearly three seconds
  // before the headline settled, which meant a visitor's first impression was a blank screen —
  // an expensive way to look sophisticated. The caret flourish now happens *underneath* the copy
  // arriving, not before it.
  const tl = gsap.timeline({ defaults: { ease: 'expo.out', duration: 0.55 } });

  tl.from('[data-anim="eyebrow"]', { opacity: 0, y: 10 })
    // The URL arrives one segment at a time, left to right — the order you actually read it in,
    // which is the order that gets people phished.
    .from('[data-anim="url"]', { opacity: 0, y: 18, duration: 0.5, stagger: 0.07 }, '-=0.35')
    // The owner locks from grey to red: the moment you learn who really owns this link.
    .fromTo(
      owner,
      { color: '#6e6c69' },
      { color: '#ff6a55', duration: 0.45, ease: 'power2.out' },
      '-=0.15'
    )
    .from('[data-anim="thesis"]', { opacity: 0, y: 14 }, '-=0.35')
    .from('[data-anim="sub"]', { opacity: 0, y: 12, duration: 0.45 }, '-=0.35')
    .from('[data-anim="cta"]', { opacity: 0, y: 10, duration: 0.45, stagger: 0.06 }, '-=0.3');

  // Caret: two blinks over the owner, running alongside the copy rather than blocking it.
  gsap
    .timeline({ delay: 0.5 })
    .set(caret, { opacity: 1 })
    .to(caret, { opacity: 0.15, duration: 0.32, repeat: 2, yoyo: true })
    .to(caret, { opacity: 0, duration: 0.25 });

  // One slow ambient drift. Not a field of blobs.
  gsap.to('.hero__aura', {
    xPercent: 8,
    yPercent: -6,
    duration: 14,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });
}

function scrollChoreography() {
  if (REDUCED) {
    gsap.set('.section__head > *, .specimen, .check, .claim, .steps li, .owner > *', {
      opacity: 1,
      y: 0,
    });
    $$('.check__fill').forEach((f) => (f.style.width = `${f.dataset.pct}%`));
    return;
  }

  $$('.section').forEach((section) => {
    gsap.from(section.querySelectorAll('.section__head > *'), {
      scrollTrigger: { trigger: section, start: 'top 76%' },
      opacity: 0,
      y: 22,
      duration: 0.7,
      stagger: 0.07,
      ease: 'expo.out',
    });
  });

  gsap.from('.specimen', {
    scrollTrigger: { trigger: '#specimens', start: 'top 82%' },
    opacity: 0,
    y: 26,
    duration: 0.6,
    stagger: 0.05,
    ease: 'expo.out',
  });

  // Each weight bar animates to the check's real weight, scaled against the strongest signal.
  // The bar is data, not decoration — that is the whole reason it is allowed to move.
  $$('.check').forEach((check) => {
    const fill = $('.check__fill', check);
    gsap.to(fill, {
      scrollTrigger: { trigger: check, start: 'top 88%' },
      width: `${fill.dataset.pct}%`,
      duration: 0.9,
      ease: 'expo.out',
    });
  });

  gsap.from('.claim', {
    scrollTrigger: { trigger: '.claims', start: 'top 80%' },
    opacity: 0,
    y: 24,
    duration: 0.65,
    stagger: 0.08,
    ease: 'expo.out',
  });

  gsap.from('.steps li', {
    scrollTrigger: { trigger: '.steps', start: 'top 82%' },
    opacity: 0,
    x: -18,
    duration: 0.55,
    stagger: 0.07,
    ease: 'expo.out',
  });

  gsap.from('.owner > *', {
    scrollTrigger: { trigger: '.owner', start: 'top 84%' },
    opacity: 0,
    y: 22,
    duration: 0.7,
    stagger: 0.1,
    ease: 'expo.out',
  });
}


/* ══ The Machine ═══════════════════════════════════════════════════════════════════════════
   A pinned, scroll-scrubbed walkthrough of the 250ms between resting on a link and clicking it.
   This exists because a landing page that only *tells* you what a hover tool does is asking the
   visitor to imagine the product. Here they scrub through it.

   The URL under examination is evaluated by the real engine, so the checks that light up and the
   score that climbs are the engine's actual output — not a scripted sequence. */

const MACHINE_URL = 'https://example.com@secure-billing.invalid/invoice/pay';

/**
 * Captions are fired BY the timeline, not matched to guessed progress values. An earlier pass
 * hardcoded `at: 0.32` style thresholds and they drifted out of sync with the tweens — the page
 * said "you rest on it" while the visual had already moved on to the dissection, which is worse
 * than no caption at all.
 */
const ACTS = [
  { title: 'A link arrives', caption: 'It looks like every other billing email. The button says exactly what you expect it to say.' },
  { title: 'You rest on it', caption: 'Nothing runs until you dwell for 250ms. A cursor crossing the page triggers nothing at all.' },
  { title: 'The address is read', caption: 'As text. We never follow it — resolving the link would be a request to their server, from your IP, that you never asked for.' },
  { title: 'It comes apart', caption: 'Everything before the @ is thrown away by your browser. What is left is the site you actually reach.' },
  { title: 'Fourteen checks run', caption: 'Each is independent and returns a weight. They stack — no single rule decides the answer.' },
  { title: 'You get an answer', caption: 'Before the click. Before the page loads. Before anything is typed into it.' },
];

function buildMachine() {
  const pin = $('#machinePin');
  const list = $('#fireList');
  if (!pin || !list) return null;

  const result = evaluate(MACHINE_URL, { anchorText: 'View invoice →' });
  const hits = new Set(result.signals.map((s) => s.id));

  // Show the signals that fired first, then a few quiet ones so "14 checks" is visibly true.
  const ordered = [
    ...result.signals.map((s) => ({ id: s.id, w: s.weight, hit: true })),
    ...Object.entries(WEIGHTS)
      .filter(([id]) => !hits.has(id))
      .slice(0, 4)
      .map(([id, w]) => ({ id, w, hit: false })),
  ];

  for (const item of ordered) {
    const li = document.createElement('li');
    li.className = 'fire__item';
    li.dataset.hit = String(item.hit);
    const name = document.createElement('span');
    name.textContent = item.id;
    const w = document.createElement('span');
    w.className = 'fire__w';
    w.textContent = item.hit ? `+${Math.round(item.w)}` : '—';
    li.append(name, w);
    list.append(li);
  }

  return { result, items: [...list.children], score: Math.round(result.score) };
}

function machineChoreography(machine) {
  if (!machine) return;
  const { result, items, score } = machine;

  const title = $('#machineTitle');
  const caption = $('#machineCaption');
  const setAct = (i) => {
    if (!title || !caption) return;
    title.textContent = ACTS[i].title;
    caption.textContent = ACTS[i].caption;
  };

  if (REDUCED) {
    // Stacked, static, fully readable. Reduced motion removes movement, not the explanation.
    gsap.set(['#mock', '#strip', '#fire'], { opacity: 1, clearProps: 'transform' });
    gsap.set('.lab, #noRequest', { opacity: 1 });
    items.forEach((el) => gsap.set(el, { opacity: el.dataset.hit === 'true' ? 1 : 0.35 }));
    $('#fireNum').textContent = String(score);
    setAct(3);  // the dissection act reads best as a static summary
    return;
  }

  const mock = $('#mock');
  const ghost = $('#ghost');
  const ring = $('.ghost__ring circle');
  const strip = $('#strip');
  const fire = $('#fire');
  const num = $('#fireNum');
  const stage = $('#stage');

  gsap.set([strip, fire], { opacity: 0 });

  /**
   * Where the cursor should come to rest, measured from the actual button rather than guessed.
   *
   * The DWELL RING is what has to line up, not the arrow: it is the thing the caption is talking
   * about. The ring is centred in the 44px ghost box, so the box goes at the link's centre minus
   * half the box. Offsetting by the arrow tip instead left the ring sitting a full box-height
   * below the button, which read as the cursor having missed.
   */
  const GHOST = 44;
  const ghostTarget = () => {
    const link = $('#mockLink');
    const box = stage.getBoundingClientRect();
    if (!link) return { x: 90, y: 190 };
    const l = link.getBoundingClientRect();
    return {
      x: l.left - box.left + l.width / 2 - GHOST / 2,
      y: l.top - box.top + l.height / 2 - GHOST / 2,
    };
  };

  /**
   * Put each segment label under the segment it names. Only when the URL sits on one line —
   * once it wraps, "under" stops meaning anything and the plain flex row is honest instead.
   */
  const alignLabels = () => {
    const urlEl = $('#stripUrl');
    const labels = $('#stripLabels');
    if (!urlEl || !labels) return;
    const segs = $$('.seg', urlEl);
    const oneLine = segs.length > 0 && new Set(segs.map((n) => Math.round(n.getBoundingClientRect().top))).size === 1;
    labels.dataset.aligned = String(oneLine);
    if (!oneLine) {
      $$('.lab', labels).forEach((l) => l.style.removeProperty('--x'));
      return;
    }
    const base = urlEl.getBoundingClientRect().left;
    for (const lab of $$('.lab', labels)) {
      const seg = $(`.seg[data-seg="${lab.dataset.for}"]`, urlEl);
      if (seg) lab.style.setProperty('--x', `${Math.round(seg.getBoundingClientRect().left - base)}px`);
    }
  };

  const target = ghostTarget();
  // Recompute AFTER a refresh settles (not refreshInit — layout is mid-change at that point).
  ScrollTrigger.addEventListener('refresh', () => {
    const t = ghostTarget();
    target.x = t.x;
    target.y = t.y;
    alignLabels();
  });
  alignLabels();
  window.addEventListener('resize', alignLabels, { passive: true });

  gsap.set(ghost, { opacity: 0, x: target.x - 130, y: target.y + 150 });

  const counter = { v: 0 };

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '.machine',
      start: 'top top',
      // Long scroll distance: this is the one place on the page worth slowing a visitor down.
      end: '+=420%',
      pin: '#machinePin',
      scrub: 0.6,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  // ACT 1 — the message settles in.
  tl.call(() => setAct(0))
    .from(mock, { opacity: 0, y: 26, duration: 0.6 })
    .to({}, { duration: 0.5 })

    // ACT 2 — the cursor arrives and dwells. The ring IS the 250ms.
    .call(() => setAct(1))
    .to(ghost, { opacity: 1, duration: 0.2 }, '>')
    .to(ghost, { x: () => target.x, y: () => target.y, duration: 0.9, ease: 'power2.inOut' })
    // The ring filling IS the 250ms dwell. It is the only literal thing on the page.
    .to(ring, { strokeDashoffset: 0, duration: 0.9 })
    .to('#mockLink', { boxShadow: '0 0 0 3px rgba(91,214,164,.55)', duration: 0.3 }, '<0.55')
    .to({}, { duration: 0.35 })

    // ACT 3 — the href lifts out of the anchor and becomes the subject.
    .call(() => setAct(2))
    .to(mock, { opacity: 0, y: -18, scale: 0.97, duration: 0.6 }, '>')
    .to(ghost, { opacity: 0, duration: 0.3 }, '<')
    .set('#mockLink', { boxShadow: 'none' })
    .fromTo(strip, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7 }, '<0.2')
    .to('#noRequest', { opacity: 1, duration: 0.4 })
    .to({}, { duration: 0.6 })

    // ACT 4 — segments get named. The userinfo strike-through is the whole trick, so it lands last.
    .call(() => setAct(3))
    .to('.lab[data-for="scheme"]', { opacity: 1, duration: 0.3 }, '>')
    .to('.lab[data-for="path"]', { opacity: 1, duration: 0.3 }, '<0.1')
    .to('.lab[data-for="userinfo"]', { opacity: 1, duration: 0.4 }, '>')
    .to('.seg--fake', { opacity: 0.45, duration: 0.4 }, '<')
    .to('.lab[data-for="owner"]', { opacity: 1, duration: 0.4 }, '>')
    .to('.seg--owner', { scale: 1.04, duration: 0.3, transformOrigin: 'left center' }, '<')
    .to('.seg--owner', { scale: 1, duration: 0.3 })
    .to({}, { duration: 0.5 })

    // ACT 5 — the checks, then the score climbing to the engine's real number.
    .call(() => setAct(4))
    .to(strip, { opacity: 0, y: -16, duration: 0.5 }, '>')
    .fromTo(fire, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, '<0.2')
    .from(items, { opacity: 0, x: -14, duration: 0.35, stagger: 0.12 }, '<0.1')
    .to(
      counter,
      {
        v: score,
        duration: 1.2,
        onUpdate: () => {
          if (num) num.textContent = String(Math.round(counter.v));
        },
      },
      '<0.3'
    )
    .to({}, { duration: 0.6 })

    // ACT 6 — the verdict, rendered by the extension's own badge component.
    .call(() => setAct(5))
    .add(() => {
      const box = stage.getBoundingClientRect();
      showBadge({
        verdict: result.verdict,
        host: truncateHost(result.parsed.host, 34),
        registrable: result.parsed.registrable,
        reason: primaryReason(result),
        x: box.left + Math.min(box.width * 0.42, 340),
        y: box.top + box.height * 0.42,
      });
    })
    .to({}, { duration: 1.2 });

  // Leaving the pinned section in either direction must not strand the badge on screen.
  ScrollTrigger.create({
    trigger: '.machine',
    start: 'top top',
    end: '+=420%',
    onLeave: hideBadge,
    onLeaveBack: hideBadge,
  });
}

/* ── Rail + nav state ─────────────────────────────────────────────────────────────────── */

function wireRail() {
  const path = $('#railPath');
  const fill = $('#railFill');
  const nav = $('#nav');
  const links = $$('.nav__links a');

  ScrollTrigger.create({
    start: 'top -80',
    end: 99999,
    onUpdate: (self) => nav?.setAttribute('data-scrolled', String(self.scroll() > 80)),
  });

  gsap.to(fill, {
    height: '100%',
    ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: true },
  });

  $$('[data-rail]').forEach((section) => {
    ScrollTrigger.create({
      trigger: section,
      start: 'top 45%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (!self.isActive) return;
        const name = section.dataset.rail;
        if (path) path.textContent = name;
        const id = section.id;
        links.forEach((a) => {
          if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      },
    });
  });
}

/**
 * Assemble the contact address in the DOM rather than shipping it in the HTML.
 *
 * This defeats the scrapers that read markup, which is most of them. It is not a security control
 * — anything rendered can be read — so it must not cost usability: the address is real text once
 * assembled, the link is a working mailto:, and <noscript> carries a human-readable fallback.
 */
function wireMail() {
  const a = $('#mailLink');
  const text = $('#mailText');
  if (!a || !text) return;
  const addr = `${a.dataset.u}@${a.dataset.d}`;
  a.href = `mailto:${addr}`;
  text.textContent = addr;
}

/* ── Boot ─────────────────────────────────────────────────────────────────────────────── */

const cards = buildSpecimens();
const machine = buildMachine();
wireMail();
buildChecks();
wireBadge(cards);
wireMeter();
heroChoreography();
machineChoreography(machine);
scrollChoreography();
wireRail();

// Fonts change metrics after load; ScrollTrigger's cached positions must be recomputed or every
// trigger fires a few dozen pixels off.
document.fonts?.ready.then(() => ScrollTrigger.refresh());
