#!/usr/bin/env node
/**
 * Download the public corpora the URL model is trained and evaluated on (ADR-0019).
 * Dev-time only. Writes plain URL lists into `.model-data/` (gitignored — live phishing URLs never
 * enter the repo, the same rule tests/fixtures/urls.json follows).
 *
 * These are URL *strings*. Nothing here visits a phishing page; we download lists about them.
 *
 *   phish-train.txt   Phishing.Database ACTIVE (sampled) + PhiUSIIL phishing
 *   phish-fresh.txt   OpenPhish community feed — the newest phish, used ONLY for evaluation
 *   benign-home.txt   Tranco top sites 5,001–150,000, as homepages
 *   benign-top.txt    Tranco top 5,000 homepages — evaluation only
 *   benign-paths.txt  real links cited on Wikipedia, 30+ languages (train)
 *   benign-test.txt   a separate Wikipedia batch on different hosts — evaluation only
 *   login-train.txt   real login/account/admin URLs of legitimate sites (Wayback CDX)
 *   login-test.txt    the same, on a disjoint 1-in-5 of those sites — evaluation only
 *
 * The Wikipedia sets exist because the public phishing datasets' "legitimate" side is almost all
 * bare homepages. A model trained on those learns "has a path = phishing" and flags every real
 * article and login link on the web.
 *
 *   node scripts/model/fetch-data.mjs [--wiki-rounds 45] [--login-sites 400]
 *
 * The login-page step is slow (the Wayback index takes 20–60s per site); ~1 hour for 400 sites.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = '.model-data';
const UA = 'InertLink-model-data/0.1 (+https://github.com/iAaquibjawed/inertlink)';
const flag = (name, dflt) => Number(process.argv[process.argv.indexOf(name) + 1]) || dflt;
const WIKI_ROUNDS = flag('--wiki-rounds', 45);
const LOGIN_SITES = flag('--login-sites', 400);
const LANGS = ['en', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'id', 'ru', 'ja', 'pl', 'tr', 'vi', 'ar', 'hi', 'sv',
  'ko', 'uk', 'fa', 'zh', 'cs', 'hu', 'ro', 'el', 'he', 'th', 'fi', 'da', 'no', 'ms', 'bn', 'sr', 'bg', 'ca'];

fs.mkdirSync(DIR, { recursive: true });
const out = (name, lines) => {
  fs.writeFileSync(path.join(DIR, name), [...new Set(lines)].join('\n') + '\n');
  console.log(`${name.padEnd(18)} ${new Set(lines).size}`);
};
const urls = (text) => text.split('\n').map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
const hostOf = (u) => u.split('/')[2]?.toLowerCase() ?? '';

async function text(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function unzipTo(url, file) {
  const zip = path.join(DIR, file);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zip, '-d', DIR]);
}

/** Deterministic sampler, so two runs of this script produce the same training set. */
function sample(list, fraction, seed = 3) {
  let s = seed;
  return list.filter(() => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 < fraction);
}

async function wikiLinks(rounds) {
  const jobs = LANGS.flatMap((lang) => Array.from({ length: rounds }, () => lang));
  const links = [];
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = await Promise.all(
      jobs.slice(i, i + 6).map(async (lang) => {
        try {
          const api = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=50&prop=extlinks&ellimit=max&format=json`;
          const pages = Object.values(JSON.parse(await text(api)).query?.pages ?? {});
          return pages.flatMap((p) => (p.extlinks ?? []).map((l) => l['*']));
        } catch {
          return [];
        }
      })
    );
    links.push(...batch.flat());
  }
  // Cap per host so archive.org and doi.org cannot dominate what "legitimate" means.
  const per = new Map();
  return urls(links.join('\n')).filter((u) => {
    const n = (per.get(hostOf(u)) ?? 0) + 1;
    per.set(hostOf(u), n);
    return n <= 15;
  });
}

const pdb = urls(await text('https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt'));
await unzipTo('https://archive.ics.uci.edu/static/public/967/phiusiil+phishing+url+dataset.zip', 'phiusiil.zip');
const phiusiil = fs
  .readFileSync(path.join(DIR, 'PhiUSIIL_Phishing_URL_Dataset.csv'), 'utf8')
  .split('\n')
  .map((l) => l.split(','))
  .filter((c) => c.at(-1)?.trim() === '0') // PhiUSIIL: label 0 = phishing
  .map((c) => c[1]);
out('phish-train.txt', [...sample(pdb, 0.45), ...urls(phiusiil.join('\n'))]);
out('phish-fresh.txt', urls(await text('https://openphish.com/feed.txt')));

await unzipTo('https://tranco-list.eu/top-1m.csv.zip', 'tranco.zip');
const tranco = fs.readFileSync(path.join(DIR, 'top-1m.csv'), 'utf8').split('\n').map((l) => l.split(',')[1]?.trim()).filter(Boolean);
out('benign-top.txt', tranco.slice(0, 5000).map((d) => `https://${d}/`));
out('benign-home.txt', tranco.slice(5000, 150000).map((d) => `https://${d}/`));

/**
 * Real login/account/admin pages of legitimate sites. Wikipedia almost never cites them, so
 * without this the model learns "login in the path = phishing" and flags every real sign-in page.
 */
async function loginPages(domains) {
  const RX = 'original:.*(login|signin|sign-in|sign_in|logon|account|auth|password|admin|verify|secure|session|checkout|billing|register|signup|profile|dashboard|settings).*';
  const train = [];
  const test = [];
  for (let i = 0; i < domains.length; i += 4) {
    const batch = await Promise.all(
      domains.slice(i, i + 4).map(async (d) => {
        try {
          const api = `https://web.archive.org/cdx/search/cdx?url=${d}&matchType=domain&filter=${RX}&collapse=urlkey&limit=15&fl=original&from=2022`;
          return urls(await text(api)).filter((u) => !u.includes(','));
        } catch {
          return [];
        }
      })
    );
    batch.forEach((list, j) => ((i + j) % 5 === 0 ? test : train).push(...list));
  }
  return { train, test };
}

const test = await wikiLinks(4);
const testHosts = new Set(test.map(hostOf));
out('benign-test.txt', test);
out('benign-paths.txt', (await wikiLinks(WIKI_ROUNDS)).filter((u) => !testHosts.has(hostOf(u))));

const loginDomains = sample(tranco.slice(5000, 60000), LOGIN_SITES / 55000, 11);
const login = await loginPages(loginDomains);
out('login-train.txt', login.train);
out('login-test.txt', login.test);
