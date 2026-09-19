/**
 * Settings state for the popup and options pages.
 *
 * Both surfaces are open at once often enough to matter (options in a tab, popup from the
 * toolbar), and the content script is a third reader. `onSettingsChanged` keeps all three in
 * sync, so a toggle flipped in one place is live everywhere without a reload.
 *
 * Writes are optimistic: the switch moves immediately and storage catches up. A settings write
 * that fails is not worth blocking a 200ms interaction on, and the change listener corrects the
 * UI if the write really did not land.
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, readSettings, writeSettings, onSettingsChanged } from '../shared/settings.js';

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    readSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    const unsubscribe = onSettingsChanged((patch) => {
      if (alive) setSettings((prev) => ({ ...prev, ...patch }));
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    writeSettings(patch).catch(() => {
      // The change listener is the correction path; an alert here would be noise.
    });
  }, []);

  /** Add/remove a host in one of the list settings, without duplicates. */
  const toggleInList = useCallback((listName, host, present) => {
    setSettings((prev) => {
      const current = prev[listName] ?? [];
      const next = present ? [...new Set([...current, host])] : current.filter((h) => h !== host);
      writeSettings({ [listName]: next }).catch(() => {});
      return { ...prev, [listName]: next };
    });
  }, []);

  return { settings, loaded, update, toggleInList };
}
