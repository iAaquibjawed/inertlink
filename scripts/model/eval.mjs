#!/usr/bin/env node
/**
 * Score URL lists with a trained model, and with the full engine, and report catch rate / false
 * alarm rate. Dev-time only (ADR-0019).
 *
 *   node scripts/model/eval.mjs --model src/engine/data/url-model.json \
 *        --phish fresh.txt,holdout.txt --benign tranco.txt,wiki.txt [--misses out.txt]
 *
 * "Engine" numbers are what a user actually sees: every check plus the model, through scoring.js.
 */

import fs from 'node:fs';
import { parseUrl } from '../../src/engine/parse.js';
import { decodeModel, phishProbability } from '../../src/engine/model/score.js';
import { evaluate } from '../../src/engine/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const files = (s) => (s ? s.split(',').filter(Boolean) : []);
const decoded = decodeModel(JSON.parse(fs.readFileSync(args.model ?? 'src/engine/data/url-model.json', 'utf8')));
const sensitivity = args.sensitivity ?? 'balanced';

const readUrls = (f) =>
  [...new Set(fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];

const THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95];

function run(file, label) {
  const urls = readUrls(file);
  const hits = Object.fromEntries(THRESHOLDS.map((t) => [t, 0]));
  const verdicts = { safe: 0, caution: 0, danger: 0, unknown: 0 };
  const wrong = [];
  let n = 0;
  for (const u of urls) {
    const p = parseUrl(u);
    if (!p?.host) continue;
    n++;
    const i = u.indexOf('#');
    const prob = phishProbability(p, decoded, i === -1 ? '' : u.slice(i));
    for (const t of THRESHOLDS) if (prob >= t) hits[t]++;
    const v = evaluate(u, { sensitivity });
    verdicts[v.verdict]++;
    const flagged = v.verdict === 'caution' || v.verdict === 'danger';
    if (flagged !== Boolean(label)) wrong.push(`${v.verdict}\t${prob.toFixed(3)}\t${v.signals.map((s) => s.id).join(',')}\t${u}`);
  }
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;
  const kind = label ? 'caught' : 'false alarm';
  console.log(
    `${label ? 'PHISH ' : 'BENIGN'} ${file.split('/').pop().padEnd(22)} n=${String(n).padEnd(6)} model ${kind}: ` +
      THRESHOLDS.map((t) => `≥${t} ${pct(hits[t])}`).join('  ') +
      `  | engine: caution ${pct(verdicts.caution)} danger ${pct(verdicts.danger)} → ${kind} ${pct(verdicts.caution + verdicts.danger)}`
  );
  return wrong;
}

const misses = [];
for (const f of files(args.phish)) misses.push(...run(f, 1));
for (const f of files(args.benign)) misses.push(...run(f, 0));
if (args.misses) fs.writeFileSync(args.misses, misses.join('\n') + '\n');
