import { describe, expect, it } from 'vitest';
import MODEL from '../src/engine/data/url-model.json';
import { parseUrl } from '../src/engine/parse.js';
import { extractFeatures, DIM, DENSE } from '../src/engine/model/features.js';
import { decodeModel, explain, phishProbability } from '../src/engine/model/score.js';
import urlModel from '../src/engine/checks/url-model.js';

const decoded = decodeModel(MODEL);
const p = (u) => phishProbability(parseUrl(u), decoded);

describe('url model (ADR-0019)', () => {
  it('ships weights that match the feature code', () => {
    // A mismatch here means features.js changed without a retrain: every score would be noise.
    expect(MODEL.dim).toBe(DIM);
    expect(Object.keys(MODEL.dense).sort()).toEqual([...DENSE].sort());
  });

  it('decodes to a sparse table with real weights in it', () => {
    const nonzero = decoded.sparse.reduce((n, v) => n + (v !== 0), 0);
    expect(nonzero).toBeGreaterThan(500);
  });

  it('is deterministic — the same URL always scores the same', () => {
    const u = 'https://secure-update-account.example-bank.xyz/login.php?session=abc';
    expect(p(u)).toBe(p(u));
    expect(extractFeatures(parseUrl(u)).sparse).toEqual(extractFeatures(parseUrl(u)).sparse);
  });

  it('returns a probability and names the part of the URL behind it', () => {
    const r = explain(parseUrl('https://a.invalid/x'), decoded);
    expect(r.probability).toBeGreaterThanOrEqual(0);
    expect(r.probability).toBeLessThanOrEqual(1);
    expect(['host', 'path', 'query']).toContain(r.part);
  });

  it('never scores the local network', () => {
    for (const u of ['http://192.168.1.1/admin', 'http://localhost:3000/login', 'http://10.0.0.5/setup.php']) {
      expect(urlModel.run(parseUrl(u)).hit, u).toBe(false);
    }
  });

  it('gives a reason a person can read when it fires', () => {
    for (const u of [
      'http://verify-account-update-login.xyz/wp-includes/secure/login.php?cmd=login_submit&id=a8f3',
      'https://docs-share-0x9f.pages.dev/office365/index.html',
    ]) {
      const r = urlModel.run(parseUrl(u));
      if (r.hit) expect(r.reason).toMatch(/^Built like known phishing links — especially /);
    }
  });

  it('ignores the scheme — the non-https check owns that signal', () => {
    expect(p('http://a-shop.invalid/cart')).toBe(p('https://a-shop.invalid/cart'));
  });
});
