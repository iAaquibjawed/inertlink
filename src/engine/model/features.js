/**
 * Lexical URL features for the learned model (ADR-0019). PURE — golden rule 5.
 *
 * This file is the single definition of how the model *sees* a URL. The offline trainer
 * (`scripts/model/train.mjs`) imports this exact module, so the features a weight was learned on
 * and the features it is applied to on hover cannot drift apart. Change anything here and the
 * shipped weights are stale: retrain.
 *
 * Two families:
 *   • sparse, hashed  — character trigrams of the host, words and shapes from host/path/query.
 *                       This is where "what phishing names look like" is learned.
 *   • dense, numeric  — lengths, depths, ratios, and the brand facts from brands.js.
 *
 * Deliberately excluded: anything a rule already scores — free hosting, brand names, IP hosts.
 * The rules know exceptions the data cannot teach (`microsoft.github.io` *is* Microsoft; a
 * brand's CDN is the brand), and a model that also learned "github.io = phishing" counted the
 * same fact twice and overrode them. The model's job is the shape the rules cannot name.
 *
 * Also excluded: the scheme. Public datasets disagree wildly on http vs https for
 * reasons that have nothing to do with phishing (old citations, crawler normalisation), and the
 * `non-https` check already owns that signal. The leading `www.` is stripped for the same reason —
 * one popular dataset adds it to every URL.
 */

/** Hash space for sparse features. A power of two so `& (DIM - 1)` is the modulo. */
export const DIM = 1 << 18;

/** FNV-1a, 32-bit. Stable across JS engines, which the trainer/runtime parity depends on. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & (DIM - 1);
}

/** 'Shopee-tbk887' → 'a-ad': letters→a, digits→d, runs collapsed. Names have shapes. */
function shape(s) {
  return s
    .replace(/[a-z]+/gi, 'a')
    .replace(/[0-9]+/g, 'd')
    .slice(0, 12);
}

function entropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Path/query words; long opaque runs are reduced to their class so ids don't memorise. */
function pathTokens(s) {
  const out = [];
  for (const raw of s.split(/[^A-Za-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (raw.length > 20) {
      if (/^[0-9a-f]+$/i.test(raw)) out.push('<hex>');
      else if (/^[0-9]+$/.test(raw)) out.push('<num>');
      else out.push('<blob>');
      continue;
    }
    if (/^[0-9]+$/.test(raw)) {
      out.push(raw.length > 4 ? '<num>' : `<n${raw.length}>`);
      continue;
    }
    out.push(raw.toLowerCase());
  }
  return out;
}

const EMAIL_RE = /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/i;

/** Names of the dense features, in vector order. The trainer writes them into the weights file. */
export const DENSE = [
  'hostLen',
  'subDepth',
  'hostDigits',
  'hostHyphens',
  'labelEntropy',
  'labelLen',
  'pathLen',
  'pathDepth',
  'queryLen',
  'queryParams',
  'hasEmail',
  'pctEncoded',
  'upperRatio',
  'hasPort',
  'empty',
];

/**
 * @param {import('../parse.js').ParsedUrl} parsed
 * @param {string} [fragment] The `#…` part. Not in ParsedUrl, but kits put the victim's email there.
 * @param {Array} [debug] Dev-only: receives `[index, featureName]` pairs.
 * @returns {{ sparse: number[], dense: number[], parts: { host: number[], path: number[], query: number[] } }}
 *   `parts` splits the sparse indices by where in the URL they came from, so the check can say
 *   *which part* of the address looks wrong rather than just "it looks wrong".
 */
export function extractFeatures(parsed, fragment = '', debug = null) {
  const parts = { host: new Set(), path: new Set(), query: new Set() };
  let bucket = parts.host;
  // `debug` (an array) collects [index, name] so scripts/model can say which features fired.
  const add = (k) => {
    const i = hash(k);
    bucket.add(i);
    debug?.push([i, k]);
  };

  const host = parsed.host.replace(/^www\d?\./, '');
  const labels = host.split('.');
  const suffixCount = parsed.tld ? parsed.tld.split('.').length : 1;
  const owned = labels.slice(0, Math.max(labels.length - suffixCount, 0));
  const regLabel = owned[owned.length - 1] ?? '';

  // On a hosting platform the "TLD" is the platform itself — free-hosting's signal, not ours.
  if (!parsed.hosting) add(`tld:${parsed.tld}`);
  add(`shape:${shape(regLabel)}`);
  add(`depth:${Math.min(owned.length, 5)}`);

  // Trigrams over the part the owner chose — never the public suffix, which the tld feature has.
  for (const label of owned) {
    const s = `^${label}$`;
    for (let i = 0; i + 3 <= s.length; i++) add(`h3:${s.slice(i, i + 3)}`);
  }
  for (const t of owned.flatMap((l) => l.split(/[^a-z0-9]+/))) if (t) add(`ht:${t.length > 20 ? '<long>' : t}`);

  bucket = parts.path;
  const path = parsed.path;
  const segments = path.split('/').filter(Boolean);
  for (const t of pathTokens(path)) add(`pt:${t}`);
  const last = segments[segments.length - 1] ?? '';
  const ext = /\.([a-z0-9]{1,5})$/i.exec(last)?.[1]?.toLowerCase();
  add(`ext:${ext ?? (segments.length ? 'none' : 'root')}`);

  bucket = parts.query;
  const query = parsed.query.replace(/^\?/, '');
  const params = query ? query.split('&') : [];
  for (const p of params) {
    const k = p.split('=')[0].toLowerCase();
    if (k && k.length <= 20) add(`qk:${k}`);
  }
  for (const t of pathTokens(query).slice(0, 30)) add(`qt:${t}`);

  const full = `${path}${parsed.query}${fragment}`;
  const letters = path.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;

  const dense = [
    Math.min(host.length / 40, 2),
    Math.min(Math.max(owned.length - 1, 0) / 3, 2),
    Math.min((host.match(/[0-9]/g) ?? []).length / 8, 2),
    Math.min((host.match(/-/g) ?? []).length / 3, 2),
    entropy(regLabel) / 4,
    Math.min(regLabel.length / 20, 2),
    Math.min(path.length / 80, 2),
    Math.min(segments.length / 5, 2),
    Math.min(query.length / 100, 2),
    Math.min(params.length / 5, 2),
    EMAIL_RE.test(full) ? 1 : 0,
    Math.min((full.match(/%[0-9a-f]{2}/gi) ?? []).length / 10, 2),
    letters.length ? upper / letters.length : 0,
    parsed.port ? 1 : 0,
    segments.length === 0 && !query ? 1 : 0,
  ];

  const sparse = [...new Set([...parts.host, ...parts.path, ...parts.query])];
  return {
    sparse,
    dense,
    parts: { host: [...parts.host], path: [...parts.path], query: [...parts.query] },
  };
}
