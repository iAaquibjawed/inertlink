/**
 * End-to-end test: real Chrome, real unpacked extension, real service worker, real content script.
 *
 * `npm test` covers the engine, which is pure and easy to test. It cannot tell you that the
 * extension *runs* — and every failure this project has actually hit lived in that gap: a worker
 * that never started, a content script that never registered, a manifest whose paths resolved to
 * nothing. Unit tests were green through all of it. This file closes the gap.
 *
 * What it asserts:
 *   1. the extension installs and its service worker starts
 *   2. the worker registers the content script for the granted origin
 *   3. the content script injects into a page and reports itself
 *   4. hovering a link produces the verdict the golden fixtures demand — read back out of the
 *      content script's own tally, not re-derived here
 *   5. hovering issues ZERO network requests (golden rule 3)
 *   6. `ENSURE_INJECTED` activates a tab with no registered script (the activeTab path, ADR-0010)
 *
 * The one thing it cannot drive is Chrome's native permission dialog, which is browser UI. So the
 * test profile is given the origin up front; everything downstream of the prompt — which is all of
 * our own code — runs for real.
 *
 *   npm run e2e          headless
 *   HEADED=1 npm run e2e watch it happen
 */
import { launchPipe, sleep } from './cdp.mjs';
import { rm, cp, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'dist');
const PORT = 8899;
const ORIGIN = `http://localhost:${PORT}`;
const PAGE = `${ORIGIN}/phishing-sandbox.html`;

/** Each case: hover this href, expect the tally to tick in this bucket. */
const CASES = [
  ['https://example.com/', 'safe'],
  ['http://example.com/login', 'caution'],
  ['https://example.test/x/aZ9', 'caution'],
  ['https://example.com@internal.invalid/verify', 'danger'],
  ['https://exarnple.com/', 'danger'],
  ['https://paypa1.com/login', 'danger'],
  ['https://phish-demo.invalid/anything', 'danger'],
];

let failures = 0;
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const check = (cond, m) => (cond ? pass(m) : fail(m));

/* ── fixtures: a server and a copy of dist/ with the test origin granted ────────────────────── */

const server = spawn(process.execPath, [join(HERE, '..', 'manual', 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

const work = await mkdtemp(join(tmpdir(), 'inertlink-e2e-'));
const profile = join(work, 'profile');
const ext = join(work, 'ext');
await cp(DIST, ext, { recursive: true });

const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${ORIGIN}/*`];
await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

// A second copy granted "all sites", to prove the everywhere path registers correctly.
const extAll = join(work, 'ext-all');
await cp(DIST, extAll, { recursive: true });
const manifestAll = JSON.parse(await readFile(join(extAll, 'manifest.json'), 'utf8'));
manifestAll.host_permissions = ['http://*/*', 'https://*/*'];
manifestAll.name = 'InertLink (all sites)';
await writeFile(join(extAll, 'manifest.json'), JSON.stringify(manifestAll, null, 2));

const cdp = launchPipe({ profile, headless: !process.env.HEADED });

const cleanup = () => {
  cdp.kill();
  server.kill();
  rm(work, { recursive: true, force: true }).catch(() => {});
};
process.on('exit', cleanup);

async function attachTo(pred) {
  const { result } = await cdp.send('Target.getTargets');
  const t = result.targetInfos.find(pred);
  if (!t) return null;
  const { result: att } = await cdp.send('Target.attachToTarget', {
    targetId: t.targetId,
    flatten: true,
  });
  return att.sessionId;
}

const evalIn = async (session, body) => {
  const r = await cdp.evaluate(`(async () => { ${body} })()`, session);
  if (r.error) throw new Error(r.error.split('\n')[0]);
  return r.value;
};

/* ── run ───────────────────────────────────────────────────────────────────────────────────── */

await sleep(2500);
await cdp.send('Target.setDiscoverTargets', { discover: true });

console.log('\nextension');
const install = await cdp.send('Extensions.loadUnpacked', { path: ext });
const ID = install.result?.id;
check(Boolean(ID), `installs (${ID ?? JSON.stringify(install.error)})`);
if (!ID) process.exit(1);
await sleep(1500);

let sw = await attachTo((t) => t.type === 'service_worker' && t.url.includes(ID));
if (!sw) {
  // MV3 workers are lazy; opening an extension page is a legitimate way to wake one.
  await cdp.send('Target.createTarget', { url: `chrome-extension://${ID}/options/options.html` });
  await sleep(2500);
  sw = await attachTo((t) => t.type === 'service_worker' && t.url.includes(ID));
}
check(Boolean(sw), 'service worker starts');
if (!sw) process.exit(1);
await cdp.send('Runtime.enable', {}, sw);

const perms = await evalIn(sw, 'return await chrome.permissions.getAll()');
check(perms.origins.includes(`${ORIGIN}/*`), 'worker sees the granted origin');

const scripts = await evalIn(
  sw,
  'return (await chrome.scripting.getRegisteredContentScripts()).map(s => ({ id: s.id, matches: s.matches }))'
);
check(
  scripts.some((s) => s.id === 'inertlink-hover' && s.matches.includes(`${ORIGIN}/*`)),
  `registers the content script for the granted origin only (${JSON.stringify(scripts.map((s) => s.matches).flat())})`
);

console.log('\npage');
const { result: tab } = await cdp.send('Target.createTarget', { url: PAGE });
await sleep(2500);
const page = await attachTo((t) => t.targetId === tab.targetId);
await cdp.send('Runtime.enable', {}, page);
await cdp.send('Network.enable', {}, page);

const tabId = await evalIn(sw, `const [t] = await chrome.tabs.query({ url: '${ORIGIN}/*' }); return t?.id ?? null;`);
check(tabId != null, 'page tab is visible to the worker');

const state0 = await evalIn(sw, `return await chrome.tabs.sendMessage(${tabId}, { type: 'GET_TAB_STATE' })`);
check(state0?.active === true, 'content script is live and answers GET_TAB_STATE');

console.log('\nverdicts (hovered for real, read back from the content script tally)');
let prev = state0.counts;
// Requests made from here on: hovering must add none (golden rule 3).
const requestsBefore = cdp.events.filter((e) => e.method === 'Network.requestWillBeSent').length;

for (const [href, want] of CASES) {
  await evalIn(
    page,
    `const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === ${JSON.stringify(href)});
     if (!a) throw new Error('link missing from smoke page: ' + ${JSON.stringify(href)});
     a.scrollIntoView({ block: 'center' });
     await new Promise(r => setTimeout(r, 80));
     const rect = a.getBoundingClientRect();
     const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
     a.dispatchEvent(new MouseEvent('mouseover', o));
     document.dispatchEvent(new MouseEvent('mousemove', o));
     await new Promise(r => setTimeout(r, 450));
     a.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body, view: window }));
     return true;`
  );

  const next = (await evalIn(sw, `return await chrome.tabs.sendMessage(${tabId}, { type: 'GET_TAB_STATE' })`)).counts;
  const moved = Object.keys(next).filter((k) => next[k] > (prev[k] ?? 0));
  check(
    moved.length === 1 && moved[0] === want,
    `${href}  →  ${moved[0] ?? 'nothing'}${moved[0] === want ? '' : `  (expected ${want})`}`
  );
  prev = next;
}

/* ── form submit controls navigate too (ADR-0015) ───────────────────────────────────────────── */

console.log('\nsubmit controls and InertLinks');

/** Hover something by CSS selector; report which verdict bucket ticked, or null. */
async function hoverSelector(selector) {
  const before = (await evalIn(sw, `return await chrome.tabs.sendMessage(${tabId}, { type: 'GET_TAB_STATE' })`)).counts;
  await evalIn(
    page,
    `const el = document.querySelector(${JSON.stringify(selector)});
     if (!el) throw new Error('missing fixture: ' + ${JSON.stringify(selector)});
     el.scrollIntoView({ block: 'center' });
     await new Promise(r => setTimeout(r, 80));
     const rect = el.getBoundingClientRect();
     const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
     el.dispatchEvent(new MouseEvent('mouseover', o));
     document.dispatchEvent(new MouseEvent('mousemove', o));
     await new Promise(r => setTimeout(r, 500));
     el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body, view: window }));
     return true;`
  );
  const after = (await evalIn(sw, `return await chrome.tabs.sendMessage(${tabId}, { type: 'GET_TAB_STATE' })`)).counts;
  const moved = Object.keys(after).filter((k) => after[k] > (before[k] ?? 0));
  return moved[0] ?? null;
}

const submitDanger = await hoverSelector('form[action="https://phish-demo.invalid/cart/delete"] input[type=submit]');
check(submitDanger === 'danger', `<input type=submit> posting to a blocklisted host → ${submitDanger ?? 'nothing'} (expected danger)`);

const submitSafe = await hoverSelector('form[action="https://example.com/cart/save"] button');
check(submitSafe === 'safe', `<button> defaulting to submit → ${submitSafe ?? 'nothing'} (expected safe)`);

const typeButton = await hoverSelector('button[type="button"]');
check(typeButton === null, `type="button" navigates nowhere → ${typeButton ?? 'silent'} (expected silent)`);

// InertLinks are answered, not ignored — see ADR-0016. They are not tallied as a verdict, so
// the counts must NOT move; we assert the badge label instead.
async function hoverLabel(selector) {
  return evalIn(
    page,
    `const el = document.querySelector(${JSON.stringify(selector)});
     if (!el) throw new Error('missing fixture: ' + ${JSON.stringify(selector)});
     el.scrollIntoView({ block: 'center' });
     await new Promise(r => setTimeout(r, 80));
     const rect = el.getBoundingClientRect();
     const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
     el.dispatchEvent(new MouseEvent('mouseover', o));
     document.dispatchEvent(new MouseEvent('mousemove', o));
     await new Promise(r => setTimeout(r, 550));
     const host = document.getElementById('inertlink-badge-root');
     return host ? host.matches(':popover-open') : false;`
  );
}

const hashShown = await hoverLabel('a[href="#"][role="button"]');
check(hashShown === true, 'an <a href="#"> is answered as an InertLink, not met with silence');

const voidShown = await hoverLabel('a[href="javascript:void(0)"]');
check(voidShown === true, 'javascript:void(0) is an InertLink too — never Danger');

const jsCode = await hoverSelector(`a[href^="javascript:fetch"]`);
check(jsCode === 'caution', `javascript: with a real body → ${jsCode ?? 'nothing'} (expected caution)`);

/* ── the badge must actually RENDER, not merely mount ───────────────────────────────────────── */

console.log('\nbadge renders');
// Structural checks are not enough here: mount() creates the host and puts it in the top layer
// BEFORE showBadge does any work, so a throw halfway through leaves every structural assertion
// true while the user sees nothing. The content script records the throw instead.
const painted = await evalIn(
  page,
  `const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === 'https://exarnple.com/');
   a.scrollIntoView({ block: 'center' });
   await new Promise(r => setTimeout(r, 100));
   const rect = a.getBoundingClientRect();
   const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
   a.dispatchEvent(new MouseEvent('mouseover', o));
   document.dispatchEvent(new MouseEvent('mousemove', o));
   await new Promise(r => setTimeout(r, 600));
   const host = document.getElementById('inertlink-badge-root');
   return { open: !!host && host.matches(':popover-open') };`
);
const state = await evalIn(sw, `return await chrome.tabs.sendMessage(${tabId}, { type: 'GET_TAB_STATE' })`);
check(painted.open === true, 'badge enters the top layer on hover');
check(
  state.paintError === null || state.paintError === undefined,
  `badge painted without throwing${state.paintError ? ` — ${state.paintError}` : ''}`
);

/* ── the badge must outrank ordinary page chrome (ADR-0013) ─────────────────────────────────── */

console.log('\nstacking: badge vs a z-index:100 sticky nav');
// Retried: the badge needs a fresh mouseover after the previous case's mouseout, and the 250ms
// dwell plus a scroll can lose one dispatch. A flaky assertion is worse than no assertion — it
// teaches you to ignore the suite.
const stacking = await evalIn(
  page,
  `const nav = document.querySelector('.repro-nav');
   const a = nav.querySelector('a[href="https://example.com/about"]');
   window.scrollTo(0, 0);
   await new Promise(r => setTimeout(r, 120));

   for (let attempt = 0; attempt < 4; attempt++) {
     document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body, view: window }));
     await new Promise(r => setTimeout(r, 60));
     const rect = a.getBoundingClientRect();
     const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
     a.dispatchEvent(new MouseEvent('mouseover', o));
     document.dispatchEvent(new MouseEvent('mousemove', o));
     await new Promise(r => setTimeout(r, 500));

     const host = document.getElementById('inertlink-badge-root');
     if (host) {
       return {
         navZ: getComputedStyle(nav).zIndex,
         hostZ: getComputedStyle(host).zIndex,
         topLayer: host.matches(':popover-open'),
       };
     }
   }
   return { err: 'badge host never appeared after 4 attempts' };`
);
if (stacking.err) fail(stacking.err);
check(
  stacking.hostZ === '2147483647',
  `host itself carries the z-index, not just the shadow child (${stacking.hostZ})`
);
check(
  stacking.topLayer === true,
  'badge is in the top layer, so no page z-index can cover it'
);
check(
  Number(stacking.hostZ) > Number(stacking.navZ),
  `outranks the site nav (${stacking.hostZ} > ${stacking.navZ})`
);

console.log('\nprivacy');
const hoverRequests = cdp.events
  .filter((e) => e.method === 'Network.requestWillBeSent')
  .slice(requestsBefore)
  .map((e) => e.params.request.url)
  .filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('data:'));
check(
  hoverRequests.length === 0,
  `hovering issued no off-origin requests${hoverRequests.length ? ` — saw ${hoverRequests.join(', ')}` : ''}`
);

console.log('\nactiveTab activation path (ADR-0010)');
await evalIn(sw, `try { await chrome.scripting.unregisterContentScripts({ ids: ['inertlink-hover'] }); } catch {}`);
const { result: tab2 } = await cdp.send('Target.createTarget', { url: PAGE });
await sleep(2000);
const page2 = await attachTo((t) => t.targetId === tab2.targetId);
await cdp.send('Runtime.enable', {}, page2);

const bare = await evalIn(page2, `return !!document.getElementById('inertlink-badge-root')`);
check(bare === false, 'a fresh tab has no content script once registration is removed');

// Send from an extension page, exactly as the popup does. A worker cannot receive its own
// runtime.sendMessage, so sending from the worker session would only ever test the harness.
const { result: optTab } = await cdp.send('Target.createTarget', {
  url: `chrome-extension://${ID}/options/options.html`,
});
await sleep(2000);
const optSession = await attachTo((t) => t.targetId === optTab.targetId);
await cdp.send('Runtime.enable', {}, optSession);

const tabId2 = await evalIn(
  sw,
  `const ts = await chrome.tabs.query({ url: '${ORIGIN}/*' }); return ts[ts.length - 1]?.id ?? null;`
);
const injected = await evalIn(
  optSession,
  `return await chrome.runtime.sendMessage({ type: 'ENSURE_INJECTED', tabId: ${tabId2} })`
);
check(injected?.ok === true, `ENSURE_INJECTED reports success (${JSON.stringify(injected)})`);

await sleep(800);
const activated = await evalIn(
  page2,
  `const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === 'http://example.com/login');
   const rect = a.getBoundingClientRect();
   const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
   a.dispatchEvent(new MouseEvent('mouseover', o));
   document.dispatchEvent(new MouseEvent('mousemove', o));
   await new Promise(r => setTimeout(r, 600));
   return !!document.getElementById('inertlink-badge-root');`
);
check(activated === true, 'badge appears on a tab activated by injection alone');

/* ── all-sites grant: no clicking the icon, ever ────────────────────────────────────────────── */

console.log('\nall-sites grant');
const installAll = await cdp.send('Extensions.loadUnpacked', { path: extAll });
const ALL_ID = installAll.result?.id;
check(Boolean(ALL_ID), 'second extension installs with all-sites host permissions');

if (ALL_ID) {
  await sleep(1500);
  let swAll = await attachTo((t) => t.type === 'service_worker' && t.url.includes(ALL_ID));
  if (!swAll) {
    await cdp.send('Target.createTarget', { url: `chrome-extension://${ALL_ID}/options/options.html` });
    await sleep(2500);
    swAll = await attachTo((t) => t.type === 'service_worker' && t.url.includes(ALL_ID));
  }
  check(Boolean(swAll), 'its worker starts');

  if (swAll) {
    await cdp.send('Runtime.enable', {}, swAll);
    const reg = await evalIn(
      swAll,
      'return (await chrome.scripting.getRegisteredContentScripts()).flatMap(s => s.matches)'
    );
    check(
      reg.includes('http://*/*') && reg.includes('https://*/*'),
      `registers both broad patterns, collapsed (${JSON.stringify(reg)})`
    );

    // The real payoff: a brand-new tab on a never-before-seen origin just works.
    const { result: tab3 } = await cdp.send('Target.createTarget', { url: PAGE });
    await sleep(2500);
    const page3 = await attachTo((t) => t.targetId === tab3.targetId);
    await cdp.send('Runtime.enable', {}, page3);
    const auto = await evalIn(
      page3,
      `const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === 'https://exarnple.com/');
       a.scrollIntoView({ block: 'center' });
       await new Promise(r => setTimeout(r, 80));
       const rect = a.getBoundingClientRect();
       const o = { bubbles: true, cancelable: true, clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4), view: window };
       a.dispatchEvent(new MouseEvent('mouseover', o));
       document.dispatchEvent(new MouseEvent('mousemove', o));
       await new Promise(r => setTimeout(r, 600));
       return !!document.getElementById('inertlink-badge-root');`
    );
    check(auto === true, 'a fresh tab badges with no icon click and no per-site grant');
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mall end-to-end checks passed\x1b[0m\n'
    : `\n\x1b[31m${failures} end-to-end check(s) failed\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
