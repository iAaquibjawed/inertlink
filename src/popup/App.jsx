/**
 * Popup: the master switch, this site's state, and what this tab has seen.
 *
 * **Opening this popup is itself the activation.** Clicking the toolbar icon grants `activeTab`
 * for the current tab, so the first thing this component does is ask the worker to inject into
 * that tab. Badges work immediately, on the page the user is already looking at, with no prompt.
 *
 * That ordering is deliberate and was not the original design (ADR-0010). Requiring
 * `permissions.request()` before anything worked put the entire product behind a native dialog
 * that the action popup often cancels as it closes — the user clicked "turn on", the popup
 * vanished, and nothing ever happened. `activeTab` has no dialog and cannot fail that way.
 *
 * The optional host permission is now an *upgrade*, not a precondition: it makes the extension
 * survive navigation and reloads on that site instead of lasting only for this visit.
 *
 * Session counts are read live from the tab's content script, held in its memory, and gone when
 * the tab closes. Nothing is persisted — a tally of what you hovered is browsing history.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Icon, VERDICT_ICON } from '../ui/Icon.jsx';
import { fadeUp, listStagger, respectMotion } from '../ui/motion.js';
import { useSettings } from '../ui/useSettings.js';
import { sendSafe, getTabState, ensureInjected } from '../shared/messages.js';
import { ALL_SITES, isAllSites, originPattern } from '../shared/origins.js';

const VERDICT_WORD = {
  safe: 'Safe',
  caution: 'Caution',
  danger: 'Danger',
  unknown: 'Not checked',
  checking: 'Checking…',
};

/** Pages no extension may touch. Saying so beats a button that silently does nothing. */
const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/;

/**
 * `file://` is its own case and needs its own message. `new URL('file:///x').origin` is the string
 * `"null"`, so the naive pattern is `null/*` — not a match pattern, and `permissions.request()`
 * rejects it. Even a correct `file:///*` would fail, because `optional_host_permissions` declares
 * only http and https; file access is granted from chrome://extensions, not from here.
 */
const FILE_SCHEME = /^file:/;

function useActiveTab() {
  const [tab, setTab] = useState(null);

  useEffect(() => {
    chrome?.tabs
      ?.query({ active: true, currentWindow: true })
      .then(([t]) => setTab(t ?? null))
      .catch(() => setTab(null));
  }, []);

  return tab;
}

export default function App() {
  const reduced = useReducedMotion();
  const item = respectMotion(fadeUp, reduced);

  const { settings, update, toggleInList } = useSettings();
  const tab = useActiveTab();

  const [granted, setGranted] = useState(null); // null = still checking
  const [everywhere, setEverywhere] = useState(false);
  const [tabState, setTabState] = useState(null);

  const url = tab?.url ?? '';
  const isFile = FILE_SCHEME.test(url);
  const restricted = !url || RESTRICTED.test(url) || isFile;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  const paused = host ? settings.pausedHosts.includes(host) : false;

  /** Permission state, then the tab's live tally. Both are cheap and both can fail harmlessly. */
  const refresh = useCallback(async () => {
    const all = await chrome.permissions.getAll().catch(() => ({ origins: [] }));
    setEverywhere(isAllSites(all.origins ?? []));

    const pattern = originPattern(url);
    setGranted(pattern ? (all.origins ?? []).includes(pattern) || isAllSites(all.origins ?? []) : false);

    if (tab?.id != null) {
      setTabState(await sendSafe(getTabState(), { tabId: tab.id }));
    }
  }, [url, tab?.id]);

  /**
   * Activate on open. Opening this popup *is* the user invoking the extension, which is exactly
   * what `activeTab` responds to — so we can inject into this tab right now, prompt-free. Running
   * it unconditionally is safe: the content script guards against double-initialisation, and on a
   * tab we have no access to the injection simply fails and we fall through to the grant prompt.
   */
  useEffect(() => {
    if (!tab || restricted || !settings.enabled) return;
    let alive = true;
    (async () => {
      await sendSafe(ensureInjected(tab.id));
      // Give the content script a moment to attach before asking it what it has seen.
      await new Promise((r) => setTimeout(r, 150));
      if (alive) refresh();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, restricted, settings.enabled]);

  /**
   * Chrome requires the permission request to happen in the direct handler of a user gesture —
   * awaiting anything first silently drops it. So the request is the first thing we do, and the
   * injection follows.
   */
  const request = (origins) => {
    chrome.permissions.request({ origins }, async (ok) => {
      if (!ok) return;
      // Registration only affects future navigations; ask the worker to inject into this tab now.
      // The worker also injects from permissions.onAdded, because Chrome may destroy this popup
      // the moment the prompt opens and this callback would then never run (ADR-0010).
      await sendSafe(ensureInjected(tab?.id));
      refresh();
    });
  };

  const grant = () => {
    const pattern = originPattern(url);
    if (pattern) request([pattern]);
  };

  /** One prompt, then no more clicking the toolbar icon on every new site. */
  const grantEverywhere = () => request(ALL_SITES);

  const revoke = async () => {
    const pattern = originPattern(url);
    if (!pattern) return;
    await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
    setGranted(false);
    setTabState(null);
  };

  const openOptions = () => chrome?.runtime?.openOptionsPage?.();

  const counts = tabState?.counts ?? { safe: 0, caution: 0, danger: 0 };
  const seen = counts.safe + counts.caution + counts.danger;

  // The headline verdict describes the *site's coverage*, not a link. Claiming anything about a
  // link we were never asked about would be the exact false-green ADR-0006 exists to prevent.
  const live = Boolean(tabState?.active);

  let status = 'unknown';
  let statusWord = 'Not protected here';
  if (!settings.enabled) statusWord = 'Turned off';
  else if (isFile) statusWord = 'Local files need file access';
  else if (restricted) statusWord = 'Not available on this page';
  else if (paused) statusWord = 'Paused on this site';
  else if (live) {
    status = 'safe';
    statusWord = seen ? `Checking links — ${seen} so far` : 'Watching this page';
  } else if (granted) statusWord = 'Reload the page to start';

  return (
    <motion.div className="lv-popup" variants={listStagger} initial="initial" animate="animate">
      <motion.header className="lv-head" variants={item}>
        <h1 className="lv-wordmark">
          Link<span>Verify</span>
        </h1>

        <label className="lv-switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            aria-label="Enable LinkVerify"
          />
          <span className="lv-track">
            {/* layout animation carries the thumb — no left/width animation */}
            <motion.span
              className="lv-thumb"
              layout
              animate={{ x: settings.enabled ? 16 : 0 }}
              transition={
                reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }
              }
            />
          </span>
        </label>

        <button className="lv-iconbtn" onClick={openOptions} title="Settings">
          <Icon name="settings" label="Open settings" />
        </button>
      </motion.header>

      <motion.section
        className="lv-verdict-panel"
        data-verdict={status}
        variants={item}
        aria-live="polite"
      >
        <span className="lv-verdict-mark">
          <Icon name={VERDICT_ICON[status]} size={22} />
        </span>
        <span className="lv-verdict-word">{statusWord}</span>
        <span className="lv-verdict-host">{host || 'No page'}</span>
      </motion.section>

      {/* Dead-end cases get an explanation, never a button that cannot work. */}
      {isFile && (
        <motion.section className="lv-section lv-grant" variants={item}>
          <p className="lv-grant-copy">
            LinkVerify can't request access to <strong>file://</strong> pages from here. Serve the
            page over http instead, or enable file access in{' '}
            <strong>chrome://extensions → LinkVerify → Details</strong>.
          </p>
        </motion.section>
      )}

      {/* Persistence, not activation — it is already running (activeTab). See ADR-0010. */}
      {!restricted && granted === false && settings.enabled && (
        <motion.section className="lv-section lv-grant" variants={item}>
          <p className="lv-grant-copy">
            {live ? (
              <>
                Running on <strong>{host}</strong> for this visit only. Without access, you'll need
                to click the toolbar icon again on every site.
              </>
            ) : (
              <>
                LinkVerify only reads pages you allow. Allow <strong>{host}</strong> to see badges
                here.
              </>
            )}
          </p>
          <button className="lv-btn-grant" onClick={grant}>
            {live ? `Always run on ${host}` : 'Turn on for this site'}
          </button>
          {/* The answer for anyone who does not want to do this per site, ever again. */}
          <button className="lv-link lv-grant-all" onClick={grantEverywhere}>
            Or run on every site automatically
          </button>
        </motion.section>
      )}

      {everywhere && (
        <motion.section className="lv-section lv-grant" variants={item}>
          <p className="lv-grant-copy">
            Running automatically on every site. No need to click the icon.
          </p>
          <button
            className="lv-link lv-revoke"
            onClick={async () => {
              await chrome.permissions.remove({ origins: ALL_SITES }).catch(() => {});
              refresh();
            }}
          >
            Stop running on every site
          </button>
        </motion.section>
      )}

      {/* Pausing is meaningful the moment it is running, grant or no grant. */}
      {!restricted && (granted || live) && (
        <motion.section className="lv-section" variants={item}>
          <p className="lv-overline">This site</p>

          <div className="lv-row">
            <span className="lv-row-label">
              <Icon name="pause" size={16} />
              Pause on {host}
            </span>
            <label className="lv-switch">
              <input
                type="checkbox"
                checked={paused}
                onChange={(e) => toggleInList('pausedHosts', host, e.target.checked)}
                aria-label={`Pause LinkVerify on ${host}`}
              />
              <span className="lv-track">
                <motion.span
                  className="lv-thumb"
                  animate={{ x: paused ? 16 : 0 }}
                  transition={
                    reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }
                  }
                />
              </span>
            </label>
          </div>

          {/* Only offered when the grant is site-specific — removing one host from an
              all-sites grant would do nothing, and a button that does nothing is a lie. */}
          {granted && !everywhere && (
            <button className="lv-link lv-revoke" onClick={revoke}>
              Remove access to {host}
            </button>
          )}
        </motion.section>
      )}

      <motion.section className="lv-section" variants={item}>
        <p className="lv-overline">This tab</p>
        <div className="lv-stats">
          {['safe', 'caution', 'danger'].map((key) => (
            <div className="lv-stat" data-verdict={key} key={key}>
              <div className="lv-stat-value">{counts[key] ?? 0}</div>
              {/* dot is redundant reinforcement; the word carries the meaning */}
              <div className="lv-stat-label">
                <span className="lv-dot" aria-hidden="true" />
                {VERDICT_WORD[key]}
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.footer className="lv-foot" variants={item}>
        <Icon name={settings.onlineChecks ? 'globe' : 'wifiOff'} size={14} />
        {settings.onlineChecks
          ? 'Borderline links are checked online'
          : 'Local checks only — nothing leaves this device'}
        <button className="lv-link" onClick={openOptions}>
          Settings
        </button>
      </motion.footer>
    </motion.div>
  );
}
