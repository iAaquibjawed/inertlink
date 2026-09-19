/**
 * Chrome DevTools Protocol over `--remote-debugging-pipe`, with no dependencies.
 *
 * Why a pipe and not the TCP debugging port: `Extensions.loadUnpacked` — the only remaining way to
 * install an unpacked extension for a test — is refused over TCP. And it is the only way because
 * Chrome 136+ removed `--load-extension` entirely; passing it now does nothing at all, silently,
 * which is its own small trap.
 *
 * Wire format: NUL-delimited JSON. fd 3 = write to browser, fd 4 = read from browser.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function launchPipe({ profile, headless = true, extraArgs = [] }) {
  const args = [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ];

  const proc = spawn(CHROME, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });

  const [, , , writeFd, readFd] = proc.stdio;
  const stderr = [];
  proc.stderr.on('data', (d) => stderr.push(String(d)));

  let id = 0;
  const pending = new Map();
  const events = [];
  const listeners = [];
  let buffer = Buffer.alloc(0);

  readFd.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let idx;
    while ((idx = buffer.indexOf(0)) !== -1) {
      const raw = buffer.subarray(0, idx).toString('utf8');
      buffer = buffer.subarray(idx + 1);
      if (!raw) continue;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method) {
        events.push(msg);
        for (const fn of listeners) fn(msg);
      }
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((ok) => {
      const n = ++id;
      pending.set(n, ok);
      const payload = JSON.stringify(sessionId ? { id: n, method, params, sessionId } : { id: n, method, params });
      writeFd.write(payload + '\0');
    });

  const evaluate = async (expression, sessionId, { userGesture = false } = {}) => {
    const r = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture },
      sessionId
    );
    const d = r.result;
    if (d?.exceptionDetails) {
      return { error: d.exceptionDetails.exception?.description ?? d.exceptionDetails.text };
    }
    return { value: d?.result?.value };
  };

  const onEvent = (fn) => listeners.push(fn);

  return { proc, stderr, send, evaluate, events, onEvent, kill: () => proc.kill() };
}

export { sleep };
