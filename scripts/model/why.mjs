#!/usr/bin/env node
/**
 * Explain a model score: the features that moved it most. Dev-time only (ADR-0019).
 *   node scripts/model/run.mjs why <url> [url…]
 */
import fs from 'node:fs';
import { parseUrl } from '../../src/engine/parse.js';
import { extractFeatures, DENSE } from '../../src/engine/model/features.js';
import { decodeModel } from '../../src/engine/model/score.js';

const file = process.env.MODEL ?? 'src/engine/data/url-model.json';
const d = decodeModel(JSON.parse(fs.readFileSync(file, 'utf8')));
for (const u of process.argv.slice(2)) {
  const p = parseUrl(u);
  if (!p) continue;
  const names = [];
  const { dense } = extractFeatures(p, '', names);
  const seen = new Set();
  const terms = [['bias', d.bias]];
  for (const [i, k] of names) if (!seen.has(i)) { seen.add(i); terms.push([k, d.sparse[i] * d.scale]); }
  dense.forEach((x, j) => x && terms.push([`#${DENSE[j]}=${x.toFixed(2)}`, d.dense[j] * x]));
  const z = terms.reduce((a, [, v]) => a + v, 0);
  console.log(`\n${u}  p=${(1 / (1 + Math.exp(-z))).toFixed(3)}`);
  for (const [k, v] of terms.filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10)) {
    console.log(`  ${v >= 0 ? '+' : ''}${v.toFixed(2).padStart(6)}  ${k}`);
  }
}
