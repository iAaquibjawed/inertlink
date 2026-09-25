#!/usr/bin/env node
/**
 * Offline trainer for the URL model (ADR-0019). Dev-time only — never shipped, never run on a
 * user's machine. Output is a static weights file the engine imports at build time, so golden
 * rule 1 (no remote code) and rule 2 (no network on hover) are untouched.
 *
 * Plain logistic regression with Adagrad, no dependencies. It is small, explainable, and fast
 * enough to score a URL in microseconds on hover. It uses the engine's own `extractFeatures`, so
 * training and runtime see a URL identically.
 *
 *   node scripts/model/train.mjs --phish a.txt,b.txt --benign c.txt,d.txt \
 *        [--out src/engine/data/url-model.json] [--epochs 6]
 *
 * Input files: one URL per line (lines not starting with http are ignored). `file@0.3` keeps a
 * deterministic 30% sample — used to stop 145k bare homepages teaching "no path = safe".
 * `file@8` repeats every row 8 times — used for small, high-value sets such as real login pages,
 * which would otherwise be drowned out by a quarter-million phish.
 *
 * The split is by REGISTRABLE DOMAIN, not by URL. Splitting by URL lets the model memorise a
 * site from one of its pages and "predict" another — a score that means nothing for a phish it
 * has never seen, which is the only case this model exists for.
 */

import fs from 'node:fs';
import { parseUrl } from '../../src/engine/parse.js';
import { extractFeatures, DIM, DENSE } from '../../src/engine/model/features.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const files = (s) => (s ? s.split(',').filter(Boolean) : []);
const EPOCHS = Number(args.epochs ?? 6);
const L2 = Number(args.l2 ?? 1e-6);
const OUT = args.out ?? 'src/engine/data/url-model.json';
/** Domains that must never be trained on (the evaluation sets), one per line or as URLs. */
const EXCLUDE = new Set(
  files(args.exclude).flatMap((f) => readUrls(f).map((u) => parseUrl(u)?.registrable).filter(Boolean))
);

const RESERVED = /(^|[.-])example([.-]|$)|\.(test|invalid|localhost|example)$/i;

function readUrls(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function fragmentOf(u) {
  const i = u.indexOf('#');
  return i === -1 ? '' : u.slice(i);
}

function load(list, label) {
  const rows = [];
  const seen = new Set();
  for (const spec of list) {
    const [f, frac = '1'] = spec.split('@');
    let s = 7;
    const repeat = Math.max(1, Math.floor(Number(frac)));
    const keep = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 < Number(frac);
    for (const u of readUrls(f)) {
      if (!keep()) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      const p = parseUrl(u);
      if (!p?.host || EXCLUDE.has(p.registrable)) continue;
      // RFC 2606 names ('example.com', '.test') appear in the feeds as placeholder submissions.
      // They teach the model that the word "example" is phishing — and every fixture uses it.
      if (RESERVED.test(p.host)) continue;
      const row = { ...extractFeatures(p, fragmentOf(u)), y: label, dom: p.registrable };
      for (let k = 0; k < repeat; k++) rows.push(row);
    }
  }
  return rows;
}

const phish = load(files(args.phish), 1);
const benign = load(files(args.benign), 0);
console.log(`loaded phish=${phish.length} benign=${benign.length} excluded-domains=${EXCLUDE.size}`);

// Group split by domain: 1 in 5 domains is held out.
const held = (d) => {
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5 === 0;
};
const all = [...phish, ...benign];
const train = all.filter((r) => !held(r.dom));
const valid = all.filter((r) => held(r.dom));

// Class balance: each class contributes equal total weight, however lopsided the sources are.
const nPos = train.filter((r) => r.y === 1).length;
const nNeg = train.length - nPos;
const cw = { 1: train.length / (2 * nPos), 0: train.length / (2 * nNeg) };

const w = new Float64Array(DIM);
const g2 = new Float64Array(DIM).fill(1e-8);
const wd = new Float64Array(DENSE.length);
const gd2 = new Float64Array(DENSE.length).fill(1e-8);
let bias = 0;
let gb2 = 1e-8;
const LR = 0.1;

const score = (r) => {
  let z = bias;
  for (const i of r.sparse) z += w[i];
  for (let j = 0; j < r.dense.length; j++) z += wd[j] * r.dense[j];
  return 1 / (1 + Math.exp(-z));
};

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  for (let i = train.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [train[i], train[j]] = [train[j], train[i]];
  }
  let loss = 0;
  for (const r of train) {
    const p = score(r);
    const g = (p - r.y) * cw[r.y];
    loss += -cw[r.y] * (r.y ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
    for (const i of r.sparse) {
      const gi = g + L2 * w[i];
      g2[i] += gi * gi;
      w[i] -= (LR / Math.sqrt(g2[i])) * gi;
    }
    for (let j = 0; j < r.dense.length; j++) {
      const gj = g * r.dense[j] + L2 * wd[j];
      gd2[j] += gj * gj;
      wd[j] -= (LR / Math.sqrt(gd2[j])) * gj;
    }
    gb2 += g * g;
    bias -= (LR / Math.sqrt(gb2)) * g;
  }
  console.log(`epoch ${epoch + 1} loss ${(loss / train.length).toFixed(4)} ${report(valid)}`);
}

function report(rows) {
  const at = (t) => {
    let tp = 0, fp = 0, pos = 0, neg = 0;
    for (const r of rows) {
      const hit = score(r) >= t;
      if (r.y) { pos++; if (hit) tp++; } else { neg++; if (hit) fp++; }
    }
    return `t${t}: tpr ${(tp / pos * 100).toFixed(1)}% fpr ${(fp / neg * 100).toFixed(2)}%`;
  };
  return [0.5, 0.8, 0.9, 0.95].map(at).join(' | ');
}

// Quantise and prune: store only weights that matter, as int8 over a shared scale. A dense
// 262k-float table would be megabytes; this is what keeps the model inside the content bundle.
const PRUNE = Number(args.prune ?? 0.05);

// Refit: drop the small weights, then let the survivors re-learn with the others gone. Plain
// pruning throws away whatever the dropped weights were carrying; one more pass over only the
// kept features gets most of it back at a fraction of the size.
const kept = new Uint8Array(DIM);
for (let i = 0; i < DIM; i++) {
  if (Math.abs(w[i]) >= PRUNE) kept[i] = 1;
  else w[i] = 0;
}
for (let pass = 0; pass < Number(args.refit ?? 1); pass++) {
  for (const r of train) {
    const p = score(r);
    const g = (p - r.y) * cw[r.y];
    for (const i of r.sparse) {
      if (!kept[i]) continue;
      const gi = g + L2 * w[i];
      g2[i] += gi * gi;
      w[i] -= (LR / Math.sqrt(g2[i])) * gi;
    }
    for (let j = 0; j < r.dense.length; j++) {
      const gj = g * r.dense[j] + L2 * wd[j];
      gd2[j] += gj * gj;
      wd[j] -= (LR / Math.sqrt(gd2[j])) * gj;
    }
    gb2 += g * g;
    bias -= (LR / Math.sqrt(gb2)) * g;
  }
  console.log(`refit ${pass + 1} (${kept.reduce((a, b) => a + b, 0)} kept) ${report(valid)}`);
}

const entries = [];
let maxAbs = 0;
for (let i = 0; i < DIM; i++) {
  if (kept[i] && w[i] !== 0) {
    entries.push([i, w[i]]);
    maxAbs = Math.max(maxAbs, Math.abs(w[i]));
  }
}
const scale = maxAbs / 127;
// Delta-encoded indices (varint) + int8 weights, base64. Compact, and still plain data.
const bytes = [];
let prev = 0;
for (const [i, v] of entries) {
  let d = i - prev;
  prev = i;
  while (d >= 0x80) {
    bytes.push((d & 0x7f) | 0x80);
    d >>>= 7;
  }
  bytes.push(d);
  bytes.push(Math.max(-127, Math.min(127, Math.round(v / scale))) & 0xff);
}

const model = {
  $comment: [
    'Learned URL model — GENERATED by scripts/model/train.mjs. Do not edit by hand (ADR-0019).',
    'Static data, bundled at build time. Nothing here is code and nothing is fetched at runtime.',
  ],
  version: 1,
  trainedAt: new Date().toISOString().slice(0, 10),
  dim: DIM,
  counts: { phish: phish.length, benign: benign.length },
  bias,
  dense: Object.fromEntries(DENSE.map((k, j) => [k, Number(wd[j].toFixed(4))])),
  scale,
  sparse: Buffer.from(bytes).toString('base64'),
};
fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + '\n');
console.log(`wrote ${OUT}: ${entries.length} sparse weights, ${(JSON.stringify(model).length / 1024).toFixed(1)}kb`);
