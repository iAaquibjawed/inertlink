/**
 * The content ⇄ worker message contract. Single source of truth — PLAN.md §3.
 *
 * Do not invent ad-hoc message shapes anywhere else in the codebase (CLAUDE.md §4). If a new
 * message is needed, add it here and to PLAN.md §"Message contract" in the same commit.
 */

/** @typedef {'safe'|'caution'|'danger'|'unknown'|'checking'} Verdict */

export const MSG = Object.freeze({
  // content → worker
  CHECK_URL: 'CHECK_URL',
  // worker → content (response to CHECK_URL)
  CHECK_RESULT: 'CHECK_RESULT',
  // popup / options → worker
  GET_SETTINGS: 'GET_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS',
  CLEAR_CACHE: 'CLEAR_CACHE',
  // popup → worker: make sure the content script is running on a freshly granted tab
  ENSURE_INJECTED: 'ENSURE_INJECTED',
  // popup → content script (via chrome.tabs.sendMessage): what has this tab seen?
  GET_TAB_STATE: 'GET_TAB_STATE',
});

export const VERDICT = Object.freeze({
  SAFE: 'safe',
  CAUTION: 'caution',
  DANGER: 'danger',
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
});

/** Verdict severity, for "is this worse than that" comparisons. Higher wins. */
export const VERDICT_RANK = Object.freeze({
  [VERDICT.CHECKING]: 0,
  [VERDICT.UNKNOWN]: 1,
  [VERDICT.SAFE]: 2,
  [VERDICT.CAUTION]: 3,
  [VERDICT.DANGER]: 4,
});

/**
 * content → worker. Never carries the full URL's query string to a provider — the worker is
 * responsible for sending only `host` onward (golden rule 2). `url` is passed for local
 * re-evaluation and logging only, and must not leave the device.
 *
 * @param {{ host: string, url: string, localScore: number }} payload
 */
export function checkUrl({ host, url, localScore }) {
  return { type: MSG.CHECK_URL, host, url, localScore };
}

/**
 * worker → content.
 * @param {{ host: string, verdict: Verdict, source: string, reasons: string[] }} payload
 */
export function checkResult({ host, verdict, source, reasons = [] }) {
  return { type: MSG.CHECK_RESULT, host, verdict, source, reasons };
}

export const getSettings = () => ({ type: MSG.GET_SETTINGS });
export const setSettings = (patch) => ({ type: MSG.SET_SETTINGS, patch });
export const clearCache = () => ({ type: MSG.CLEAR_CACHE });
export const ensureInjected = (tabId) => ({ type: MSG.ENSURE_INJECTED, tabId });

/**
 * popup → content script. Answered with
 * `{ active: boolean, counts: { safe, caution, danger, unknown }, paused: boolean }`.
 * Counts live in the content script's memory and die with the tab — a session tally is not
 * browsing history and is never persisted (golden rule 2).
 */
export const getTabState = () => ({ type: MSG.GET_TAB_STATE });

/**
 * Cross-context `sendMessage` that resolves to `null` instead of throwing.
 *
 * MV3 rejects when the receiver does not exist — a sleeping worker, a tab with no content script,
 * a page navigating away. All three are normal, none is an error the user should ever see, and an
 * unhandled rejection in a content script is a console error on someone else's site (golden
 * rule 6).
 */
export async function sendSafe(message, { tabId } = {}) {
  try {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.id) return null;
    return tabId == null
      ? await chrome.runtime.sendMessage(message)
      : await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}
