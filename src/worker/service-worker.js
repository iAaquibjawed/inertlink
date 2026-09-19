/**
 * MV3 service worker: message router, verdict cache owner, and the only place network happens.
 *
 * The API key and every outbound request live here, never in the content script — that keeps both
 * off the page the user is browsing (PLAN.md §2, golden rule 2).
 *
 * MV3 workers sleep. Keep state in chrome.storage, never in module scope, and never assume this
 * file is still alive between two messages (PLAN.md §6). The one exception is `inFlight` below,
 * which is a within-wake optimisation and is correct to lose.
 */

import { MSG, VERDICT, checkResult } from '../shared/messages.js';
import { readSettings, writeSettings } from '../shared/settings.js';
import { readCached, writeCached, clearCache, cacheSize } from './cache.js';
import { getProvider } from './providers/index.js';
import { registerableOrigins } from '../shared/origins.js';

const CONTENT_SCRIPT_ID = 'inertlink-hover';
const BLOCKLIST_ALARM = 'inertlink-blocklist-refresh';

/* ── content script registration (ADR-0003) ────────────────────────────────────────────────── */

/**
 * The extension ships with **no** static content script. Nothing runs on any page until the user
 * grants a host, and what we register is scoped to exactly what they granted — not `<all_urls>`
 * (golden rule 4).
 */
async function syncRegistration() {
  try {
    const granted = await chrome.permissions.getAll();
    const origins = registerableOrigins(granted.origins ?? []);

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });

    if (origins.length === 0) {
      if (existing.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
      }
      return;
    }

    const script = {
      id: CONTENT_SCRIPT_ID,
      js: ['content/content.js'],
      matches: origins,
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    };

    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (err) {
    console.warn('[inertlink] could not sync content script registration', err);
  }
}

/**
 * Registration only affects *future* navigations. A user who grants access on the page they are
 * already looking at expects it to work now, so we inject once by hand.
 */
async function injectNow(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
    return true;
  } catch {
    // Restricted pages (chrome://, the Web Store, other extensions) refuse injection by design.
    return false;
  }
}

/**
 * Inject into every already-open tab the new grant covers.
 *
 * This runs from `permissions.onAdded` rather than from the popup, and that placement is the
 * whole point: Chrome tears the popup down the moment the permission prompt opens, so the
 * popup's own "now inject" callback frequently never runs. Relying on it meant the user granted
 * access, watched the popup vanish, and saw nothing happen until they reloaded the page — which
 * reads as "the extension is broken".
 */
async function injectIntoGranted(origins = []) {
  const patterns = registerableOrigins(origins);
  if (patterns.length === 0) return;

  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    await Promise.all(tabs.filter((t) => t.id != null).map((t) => injectNow(t.id)));
  } catch {
    /* A tab that refuses injection is not an error worth surfacing. */
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    console.info('[inertlink] installed — v%s', chrome.runtime.getManifest().version);
  }
  await syncRegistration();
  // Reloading the extension tears the content script out of every open tab. Without this, a
  // developer who hits "Reload" on chrome://extensions sees a dead extension on the page they
  // were testing, with no indication that a page refresh is all it needed.
  const granted = await chrome.permissions.getAll();
  await injectIntoGranted(granted.origins ?? []);
  // Weekly, and only meaningful once the user has opted into online checks — see refreshBlocklist.
  chrome.alarms.create(BLOCKLIST_ALARM, { periodInMinutes: 60 * 24 * 7 });
});

chrome.runtime.onStartup.addListener(syncRegistration);
chrome.permissions.onRemoved.addListener(syncRegistration);

chrome.permissions.onAdded.addListener(async (permissions) => {
  await syncRegistration();
  await injectIntoGranted(permissions?.origins ?? []);
});

/* ── Layer 2 ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Requests in flight, by host. Two links to the same host hovered in quick succession share one
 * request instead of racing — fewer calls, and a host is never sent twice for one decision.
 * Module-scoped and therefore lost when the worker sleeps, which is harmless: the cache survives.
 */
const inFlight = new Map();

/**
 * Handle CHECK_URL. Every gate here is a golden-rule-2 gate, and they are checked in cheapest-
 * first order so the common case costs nothing:
 *
 *   1. online checks off (the shipped default) → no network, ever
 *   2. no provider or no key → nothing we could ask
 *   3. cache hit → the host has already been sent once; never send it again
 *   4. only then, one request, for the host alone
 *
 * The content script has already applied the borderline + allowlist gate before sending. This is
 * the second half of the same gate, in the process that actually owns the network.
 */
async function handleCheckUrl(message) {
  const host = typeof message?.host === 'string' ? message.host.toLowerCase() : '';
  const nothing = checkResult({ host, verdict: VERDICT.UNKNOWN, source: 'local-only', reasons: [] });
  if (!host) return nothing;

  const settings = await readSettings();
  if (!settings.enabled || !settings.onlineChecks) return nothing;

  const provider = getProvider(settings.provider);
  if (!provider) return nothing;
  if (provider.requiresKey && !settings.apiKey) {
    return checkResult({ host, verdict: VERDICT.UNKNOWN, source: 'no-api-key', reasons: [] });
  }

  // A user-allowlisted host must never be sent anywhere, even if a stale content script asks.
  if (settings.allowlist.some((h) => host === h || host.endsWith(`.${h}`))) return nothing;

  const cached = await readCached(host);
  if (cached) {
    return checkResult({
      host,
      verdict: cached.verdict,
      source: `${cached.source} (cached)`,
      reasons: cached.reasons ?? [],
    });
  }

  if (inFlight.has(host)) return inFlight.get(host);

  const pending = (async () => {
    try {
      const result = await provider.check(host, { apiKey: settings.apiKey });
      if (result.verdict !== VERDICT.UNKNOWN) {
        await writeCached(host, result);
      }
      return checkResult({
        host,
        verdict: result.verdict,
        source: result.source,
        reasons: result.reasons ?? [],
      });
    } catch (err) {
      console.warn('[inertlink] provider failed', err);
      return nothing; // Fail safe: the content script keeps its local verdict (golden rule 6).
    } finally {
      inFlight.delete(host);
    }
  })();

  inFlight.set(host, pending);
  return pending;
}

/**
 * Blocklist refresh (PLAN.md §5, Phase 5).
 *
 * Deliberately inert unless the user has opted into online checks AND configured a feed URL. A
 * product that promises no network by default cannot ship a background job that phones home on a
 * timer — that would be the exact betrayal the privacy defaults exist to prevent. The bundled
 * list in `engine/data/blocklist.json` works offline and is what ships.
 */
async function refreshBlocklist() {
  try {
    const settings = await readSettings();
    if (!settings.enabled || !settings.onlineChecks || !settings.blocklistUrl) return;

    const res = await fetch(settings.blocklistUrl, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return;

    const data = await res.json();
    const hosts = (Array.isArray(data) ? data : (data.hosts ?? []))
      .filter((h) => typeof h === 'string')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50000);

    if (hosts.length) {
      await chrome.storage.local.set({
        'il:remote-blocklist': { hosts, fetchedAt: Date.now() },
      });
    }
  } catch {
    /* A failed refresh leaves the bundled list in place. Never a user-visible failure. */
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BLOCKLIST_ALARM) refreshBlocklist();
});

/* ── message router ────────────────────────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Every branch is wrapped: a throw in the worker must never surface on the user's page.
  (async () => {
    try {
      switch (message?.type) {
        case MSG.GET_SETTINGS: {
          const settings = await readSettings();
          return sendResponse({ ...settings, cacheSize: await cacheSize() });
        }

        case MSG.SET_SETTINGS:
          return sendResponse(await writeSettings(message.patch ?? {}));

        case MSG.CLEAR_CACHE: {
          const removed = await clearCache();
          return sendResponse({ ok: true, removed });
        }

        case MSG.ENSURE_INJECTED: {
          // Inject FIRST. This is the activeTab path (ADR-0010) and it is what makes the popup
          // work on click; registration is only about surviving the next navigation, so a failure
          // there must not stop us from running on the tab the user is looking at right now.
          const ok = message.tabId != null ? await injectNow(message.tabId) : false;
          syncRegistration().catch(() => {});
          return sendResponse({ ok });
        }

        case MSG.CHECK_URL:
          return sendResponse(await handleCheckUrl(message));

        default:
          return sendResponse({ ok: false, error: 'unknown-message' });
      }
    } catch (err) {
      console.warn('[inertlink] worker error', err);
      sendResponse({ ok: false, error: 'internal' });
    }
  })();

  return true; // keep the channel open for the async response
});
