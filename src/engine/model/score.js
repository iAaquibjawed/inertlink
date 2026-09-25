/**
 * Apply the learned URL model (ADR-0019). PURE — no DOM, no chrome.*, no fetch (golden rule 5).
 *
 * The weights are static data bundled at build time. Decoding happens once, lazily, on the first
 * hover, so pages the user never hovers a link on pay nothing.
 */

import { extractFeatures, DIM, DENSE } from './features.js';

/** Base64 → bytes without Buffer or atob, so this runs the same in a page, a worker, and Node. */
export function fromBase64(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/**
 * @param {object} model The parsed weights file.
 * @returns {{ sparse: Int8Array, dense: number[], bias: number, scale: number }}
 */
export function decodeModel(model) {
  if (model.dim !== DIM) throw new Error(`model dim ${model.dim} ≠ features dim ${DIM}: retrain`);
  const sparse = new Int8Array(DIM);
  const bytes = fromBase64(model.sparse);
  let idx = 0;
  for (let p = 0; p < bytes.length; ) {
    let d = 0;
    let shift = 0;
    let b;
    do {
      b = bytes[p++];
      d |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    idx += d;
    sparse[idx] = (bytes[p++] << 24) >> 24; // sign-extend int8
  }
  return {
    sparse,
    dense: DENSE.map((k) => model.dense?.[k] ?? 0),
    bias: model.bias,
    scale: model.scale,
  };
}

/**
 * Phishing probability in [0, 1].
 *
 * @param {import('../parse.js').ParsedUrl} parsed
 * @param {ReturnType<typeof decodeModel>} decoded
 * @param {string} [fragment]
 */
export function phishProbability(parsed, decoded, fragment = '') {
  return explain(parsed, decoded, fragment).probability;
}

/** Which URL part each dense feature describes, for `explain`. Same order as DENSE. */
const DENSE_PART = {
  pathLen: 'path', pathDepth: 'path', upperRatio: 'path', pctEncoded: 'path',
  queryLen: 'query', queryParams: 'query', hasEmail: 'query',
};

/**
 * Probability plus the URL part that pushed it up the most — 'host', 'path', or 'query'.
 * A badge that says *where* the address looks wrong is one the user can check for themselves.
 *
 * @returns {{ probability: number, part: 'host'|'path'|'query', push: Record<string, number> }}
 *   `push` is each part's summed contribution to the logit.
 */
export function explain(parsed, decoded, fragment = '') {
  const { dense, parts } = extractFeatures(parsed, fragment);
  const push = { host: 0, path: 0, query: 0 };
  const seen = new Set();
  let z = decoded.bias;
  for (const part of ['host', 'path', 'query']) {
    for (const i of parts[part]) {
      if (seen.has(i)) continue; // a hash shared by two parts counts once, as in training
      seen.add(i);
      const c = decoded.sparse[i] * decoded.scale;
      z += c;
      push[part] += c;
    }
  }
  for (let j = 0; j < dense.length; j++) {
    const c = decoded.dense[j] * dense[j];
    z += c;
    push[DENSE_PART[DENSE[j]] ?? 'host'] += c;
  }
  const part = Object.entries(push).sort((a, b) => b[1] - a[1])[0][0];
  return { probability: 1 / (1 + Math.exp(-z)), part, push };
}
