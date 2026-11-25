import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workbookScore, selectBbbPka, bbbBand } from '../docs/bbb.js';

const example = { rings: 3, heavy: 28, mw: 368.52, hba: 2, hbd: 0, tpsa: 6.48, pka: 8.1 };
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);

test('matches the reference BBB Score and each weighted contribution', () => {
  const { contributions: c, score } = workbookScore(example);
  close(c.rings, 0.691115);
  close(c.heavy, 0.8243256102308276);
  close(c.mwhbn, 1.5 * 0.753446812518061);
  close(c.tpsa, 2 * 0.9547655761617004);
  close(c.pka, 0.5 * 0.9703181503695548);
  close(score, 5.040301056516096);
});
test('BBB Score terms include their upper endpoints', () => {
  for (const [key, excluded, included] of [
    ['heavy', [5, 46], [6, 45]],
    ['tpsa', [0, 120.01], [0.001, 120]],
    ['pka', [3, 11.01], [3.001, 11]],
  ]) {
    for (const x of excluded)
      assert.equal(workbookScore({ ...example, [key]: x }).contributions[key], 0);
    for (const x of included)
      assert.notEqual(workbookScore({ ...example, [key]: x }).contributions[key], 0);
  }
  const at = (hba, mw = 400) => workbookScore({ ...example, hba, mw }).contributions.mwhbn;
  assert.equal(at(1), 0);
  assert.notEqual(at(1, 399), 0);
  assert.notEqual(at(9), 0);
  assert.equal(at(9, 399), 0);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((rings) => workbookScore({ ...example, rings }).contributions.rings),
    [0.336376, 0.816016, 1, 0.691115, 0.199399, 0],
  );
});
test('Gupta pKa selection and unrounded classification', () => {
  assert.equal(selectBbbPka([5, 8], [3], null).pka, 8);
  assert.equal(selectBbbPka([5], [3], null).pka, 5);
  assert.equal(selectBbbPka([4.99], [9, 6], null).pka, 6);
  assert.equal(selectBbbPka([], [9], null).pka, 9);
  assert.equal(selectBbbPka([], [9.01], null).pka, 8.81);
  assert.equal(selectBbbPka([], [], null).pka, 8.81);
  assert.equal(selectBbbPka([8], [3], 0).pka, 0);
  assert.equal(bbbBand(3.99999), 'Non-CNS-like');
  assert.equal(bbbBand(4), 'CNS-like');
});

test('batch pKa overrides feed the correct model and preserve the other score on failure', async () => {
  const { createRequire } = await import('node:module');
  const { readFile } = await import('node:fs/promises');
  const { createCalculator } = await import('../docs/chemistry.js');
  const { readList } = await import('../docs/files.js');
  const require = createRequire(import.meta.url);
  const rdkit = await require('../docs/vendor/RDKit_minimal.js')();
  const rules = await readFile(
    new URL('../docs/vendor/dimorphite/site_substructures.smarts', import.meta.url),
    'utf8',
  );
  const calculate = createCalculator(rdkit, rules);
  const [direct, invalidBbb, invalidMpo] = readList(
    'name,smiles,pka,logd,bbb_pka\nCinnarizine,C1=CC=C(C=C1)C(C2=CC=CC=C2)N3CCN(CC3)CC=CC4=CC=CC=C4,,,8.1\nNeutral,CCO,,,oops\nBase,CN,,oops,9',
    'examples.csv',
  ).map(calculate);
  assert.equal(direct.bbb.values.pka, 8.1);
  assert.equal(direct.bbb.pkaSource, 'Supplied');
  assert.equal(direct.bbb.score.toFixed(2), '5.04');
  assert.ok(invalidBbb.bbb.error);
  assert.ok(Number.isFinite(invalidBbb.mpo.score));
  assert.ok(invalidMpo.mpo.error);
  assert.equal(invalidMpo.bbb.values.pka, 9);
  assert.equal(calculate({ smiles: 'CC(=O)O' }).bbb.pkaSource, 'Most acidic site');
  assert.equal(calculate({ smiles: 'CC' }).bbb.values.pka, 8.81);
});
