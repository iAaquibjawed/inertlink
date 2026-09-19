/**
 * Options: everything that changes how the engine behaves, persisted to chrome.storage.sync.
 *
 * Two design rules doing real work here:
 *   • Progressive disclosure — the API key field only exists once online checks are on. Asking for
 *     a key before the user has opted into the network is asking for something we can't use.
 *   • Online checks default OFF (golden rule 2). The copy states plainly what leaves the device,
 *     and it tracks the *actual* setting rather than making a promise the code might not keep.
 *
 * Every control writes through `useSettings`, which broadcasts via chrome.storage.onChanged — so
 * a change here reaches the content script on every open tab without a reload.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '../ui/Icon.jsx';
import { fadeUp, listStagger, collapse, respectMotion } from '../ui/motion.js';
import { SENSITIVITY, normalizeHost } from '../shared/settings.js';
import { useSettings } from '../ui/useSettings.js';
import { MSG, sendSafe, clearCache } from '../shared/messages.js';
import { ALL_SITES, isAllSites } from '../shared/origins.js';

const SENSITIVITY_COPY = {
  [SENSITIVITY.STRICT]: 'Flags more links. Expect occasional false alarms.',
  [SENSITIVITY.BALANCED]: 'Recommended. Flags clear risks, stays quiet otherwise.',
  [SENSITIVITY.RELAXED]: 'Only high-confidence threats. Fewest interruptions.',
};

function HostList({ id, label, help, hosts, placeholder, onAdd, onRemove }) {
  const reduced = useReducedMotion();
  const item = respectMotion(fadeUp, reduced);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const host = normalizeHost(draft);
    if (!host) return setError('Enter a hostname, for example mybank.com');
    // A host with no dot is either a typo or an intranet name; both deserve a nudge, not a block
    // on the intranet case — so we only reject the clearly-wrong shape.
    if (host.includes(' ')) return setError('A hostname cannot contain spaces');
    if (hosts.includes(host)) return setError(`${host} is already on this list`);

    onAdd(host);
    setDraft('');
    setError('');
  };

  return (
    <>
      <form className="il-list-add" onSubmit={submit}>
        <label className="il-field" style={{ flex: 1, marginBottom: 0 }}>
          <span className="il-field-label">{label}</span>
          <input
            className="il-input"
            placeholder={placeholder}
            aria-describedby={`${id}-help`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError('');
            }}
            spellCheck="false"
            autoComplete="off"
          />
        </label>
        <button className="il-btn il-btn-ghost" style={{ alignSelf: 'flex-end' }} type="submit">
          <Icon name="plus" size={16} />
          Add
        </button>
      </form>
      <p className="il-field-help" id={`${id}-help`} role={error ? 'alert' : undefined}>
        {error || help}
      </p>

      {hosts.length === 0 ? (
        <p className="il-empty">No hosts yet.</p>
      ) : (
        <motion.ul className="il-list" variants={listStagger} initial="initial" animate="animate">
          <AnimatePresence initial={false}>
            {hosts.map((h) => (
              <motion.li className="il-list-item" key={h} variants={item} layout={!reduced}>
                <span>{h}</span>
                <button className="il-iconbtn-sm" onClick={() => onRemove(h)}>
                  <Icon name="trash" size={15} label={`Remove ${h}`} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </>
  );
}

export default function App() {
  const reduced = useReducedMotion();
  const item = respectMotion(fadeUp, reduced);

  const { settings, update, toggleInList } = useSettings();
  const [cacheCount, setCacheCount] = useState(null);
  const [cleared, setCleared] = useState(false);
  const [sites, setSites] = useState({ origins: [], everywhere: false });

  const refreshSites = async () => {
    const all = await chrome.permissions.getAll().catch(() => ({ origins: [] }));
    const origins = (all.origins ?? []).filter((o) => /^https?:\/\//.test(o));
    setSites({ origins, everywhere: isAllSites(origins) });
  };

  useEffect(() => {
    refreshSites();
    // Granting from the popup must show up here without a reload.
    chrome.permissions?.onAdded?.addListener(refreshSites);
    chrome.permissions?.onRemoved?.addListener(refreshSites);
    return () => {
      chrome.permissions?.onAdded?.removeListener(refreshSites);
      chrome.permissions?.onRemoved?.removeListener(refreshSites);
    };
  }, []);

  // "Clear cached verdicts" should not be a blind button — show what it will actually remove.
  useEffect(() => {
    sendSafe({ type: MSG.GET_SETTINGS }).then((s) => setCacheCount(s?.cacheSize ?? 0));
  }, [cleared]);

  const doClearCache = async () => {
    await sendSafe(clearCache());
    setCleared((n) => !n);
  };

  const { sensitivity, onlineChecks } = settings;

  return (
    <motion.main className="il-options" variants={listStagger} initial="initial" animate="animate">
      <motion.header className="il-page-head" variants={item}>
        <h1 className="il-page-title">InertLink settings</h1>
        <p className="il-page-sub">
          Link safety is checked on your device. Nothing is sent anywhere unless you turn it on
          below.
        </p>
      </motion.header>

      {/* First card on the page: nothing below it matters if InertLink is not running anywhere.
          This is also where the "why do I have to click the icon every time?" question is
          answered — see ADR-0010 for why clicking is the default. */}
      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Where InertLink runs</h2>
        <p className="il-card-help">
          By default InertLink runs only when you click its toolbar icon, on that tab, for that
          visit. Allow it to run on its own below.
        </p>

        <div className="il-toggle-row">
          <span className="il-toggle-copy">
            <strong>Run on every site automatically</strong>
            <span>No clicking. InertLink can read the pages you visit to check their links.</span>
          </span>
          <label className="il-switch">
            <input
              type="checkbox"
              checked={sites.everywhere}
              aria-label="Run on every site automatically"
              onChange={(e) => {
                // Must be called straight from the gesture — awaiting first drops the request.
                if (e.target.checked) {
                  chrome.permissions.request({ origins: ALL_SITES }, () => refreshSites());
                } else {
                  chrome.permissions.remove({ origins: ALL_SITES }, () => refreshSites());
                }
              }}
            />
            <span className="il-track">
              <motion.span
                className="il-thumb"
                animate={{ x: sites.everywhere ? 16 : 0 }}
                transition={
                  reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }
                }
              />
            </span>
          </label>
        </div>

        {!sites.everywhere && (
          <>
            <p className="il-field-help" style={{ marginTop: 'var(--il-space-md)' }}>
              Sites you've allowed individually. Add them from the toolbar popup.
            </p>
            {sites.origins.length === 0 ? (
              <p className="il-empty">No sites allowed yet.</p>
            ) : (
              <motion.ul className="il-list" variants={listStagger} initial="initial" animate="animate">
                <AnimatePresence initial={false}>
                  {sites.origins.map((o) => (
                    <motion.li className="il-list-item" key={o} variants={item} layout={!reduced}>
                      <span>{o.replace(/^https?:\/\//, '').replace(/\/\*$/, '')}</span>
                      <button
                        className="il-iconbtn-sm"
                        onClick={() =>
                          chrome.permissions.remove({ origins: [o] }, () => refreshSites())
                        }
                      >
                        <Icon name="trash" size={15} label={`Remove access to ${o}`} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </>
        )}
      </motion.section>

      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Sensitivity</h2>
        <p className="il-card-help">How eagerly InertLink raises a warning.</p>

        <div className="il-segmented" role="group" aria-label="Sensitivity">
          {Object.values(SENSITIVITY).map((level) => {
            const active = sensitivity === level;
            return (
              <button
                key={level}
                className="il-seg"
                aria-pressed={active}
                onClick={() => update({ sensitivity: level })}
              >
                {active && (
                  <motion.span
                    className="il-seg-pill"
                    layoutId="il-seg-pill"
                    transition={
                      reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36 }
                    }
                  />
                )}
                <span className="il-seg-label">{level[0].toUpperCase() + level.slice(1)}</span>
              </button>
            );
          })}
        </div>
        <p className="il-seg-note">{SENSITIVITY_COPY[sensitivity]}</p>
      </motion.section>

      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Always trust</h2>
        <p className="il-card-help">
          These hosts are marked safe instantly and are never looked up online.
        </p>
        <HostList
          id="allowlist"
          label="Add a host to your allowlist"
          help="Host only, no https:// and no path. Example: mybank.com"
          hosts={settings.allowlist}
          placeholder="mybank.com"
          onAdd={(h) => toggleInList('allowlist', h, true)}
          onRemove={(h) => toggleInList('allowlist', h, false)}
        />
      </motion.section>

      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Always warn</h2>
        <p className="il-card-help">These hosts are always flagged as dangerous.</p>
        <HostList
          id="blocklist"
          label="Add a host to your blocklist"
          help="Overrides every other signal, including the allowlist."
          hosts={settings.blocklist}
          placeholder="known-bad.example"
          onAdd={(h) => toggleInList('blocklist', h, true)}
          onRemove={(h) => toggleInList('blocklist', h, false)}
        />
      </motion.section>

      {settings.pausedHosts.length > 0 && (
        <motion.section className="il-card" variants={item}>
          <h2 className="il-card-title">Paused sites</h2>
          <p className="il-card-help">
            InertLink does nothing on these sites. Pause and resume from the toolbar popup.
          </p>
          <motion.ul className="il-list" variants={listStagger} initial="initial" animate="animate">
            <AnimatePresence initial={false}>
              {settings.pausedHosts.map((h) => (
                <motion.li className="il-list-item" key={h} variants={item} layout={!reduced}>
                  <span>{h}</span>
                  <button
                    className="il-iconbtn-sm"
                    onClick={() => toggleInList('pausedHosts', h, false)}
                  >
                    <Icon name="trash" size={15} label={`Resume on ${h}`} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        </motion.section>
      )}

      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Online reputation checks</h2>
        <p className="il-card-help">
          Optional second opinion for links the local checks can't settle.
        </p>

        <div className="il-toggle-row">
          <span className="il-toggle-copy">
            <strong>Check borderline links online</strong>
            <span>Sends the hostname only — never the full address.</span>
          </span>
          <label className="il-switch">
            <input
              type="checkbox"
              checked={onlineChecks}
              onChange={(e) => update({ onlineChecks: e.target.checked })}
              aria-label="Check borderline links online"
            />
            <span className="il-track">
              <motion.span
                className="il-thumb"
                animate={{ x: onlineChecks ? 16 : 0 }}
                transition={
                  reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }
                }
              />
            </span>
          </label>
        </div>

        {/* Progressive disclosure: don't ask for a key we have no permission to use yet. */}
        <AnimatePresence initial={false}>
          {onlineChecks && (
            <motion.div
              className="il-disclosure"
              variants={respectMotion(collapse, reduced)}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <label className="il-field" style={{ marginTop: 'var(--il-space-lg)' }}>
                <span className="il-field-label">Google Safe Browsing API key</span>
                <input
                  className="il-input"
                  type="password"
                  placeholder="Paste your key"
                  autoComplete="off"
                  spellCheck="false"
                  value={settings.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value.trim() })}
                />
                <span className="il-field-help">
                  Stored in your browser profile. Requests are made by the extension's background
                  worker, never by the page you're viewing.
                </span>
              </label>

              <label className="il-field">
                <span className="il-field-label">Blocklist feed URL (optional)</span>
                <input
                  className="il-input"
                  type="url"
                  placeholder="https://example.com/blocklist.json"
                  autoComplete="off"
                  spellCheck="false"
                  value={settings.blocklistUrl}
                  onChange={(e) => update({ blocklistUrl: e.target.value.trim() })}
                />
                <span className="il-field-help">
                  A JSON list of hosts, refreshed weekly in the background. Leave empty to use only
                  the list bundled with the extension.
                </span>
              </label>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The callout states what is true *right now*. A privacy promise that doesn't track
            the actual setting is worse than no promise. */}
        <p className="il-callout">
          <Icon name={onlineChecks ? 'globe' : 'wifiOff'} size={16} />
          <span>
            {onlineChecks
              ? 'Hostnames of borderline links are sent to your chosen provider, and only when the local checks are inconclusive. Results are cached, so a host is never sent twice.'
              : 'InertLink makes no network requests at all. Every check runs against data bundled in the extension.'}
          </span>
        </p>
      </motion.section>

      <motion.section className="il-card" variants={item}>
        <h2 className="il-card-title">Stored verdicts</h2>
        <p className="il-card-help">
          Results are cached by hostname so the same site is never looked up twice.
          {cacheCount !== null && (
            <>
              {' '}
              <strong>
                {cacheCount} {cacheCount === 1 ? 'verdict' : 'verdicts'} stored.
              </strong>
            </>
          )}
        </p>
        <button className="il-btn il-btn-danger" onClick={doClearCache} disabled={cacheCount === 0}>
          <Icon name="trash" size={16} />
          Clear cached verdicts
        </button>
      </motion.section>
    </motion.main>
  );
}
