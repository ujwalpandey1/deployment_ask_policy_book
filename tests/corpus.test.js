import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { loadCorpus } from '../src/corpus.js';
import { labCorpus, runLab } from '../src/lab.js';
import { temp, fixture } from './helpers.js';
import { validateQuestion, isDate } from '../src/util.js';

test('published source hashes and all 391 passage sections validate', async () => {
  const corpus = await loadCorpus('vendor/op05/corpus');
  assert.equal(corpus.documents.size, 34); assert.equal(corpus.passages.length, 391);
  assert.equal(corpus.visibleDocuments('public').length, 25);
  assert.equal(corpus.visibleDocuments('ops').length, 28);
  assert.equal(corpus.visibleDocuments('legal').length, 34);
  assert.equal(corpus.getDocument('HARBOUR_internal_servicing_policy', 'public'), null);
});

test('supersession is half-open, respects history, and old sources never revive', () => {
  const corpus = labCorpus(true), v1 = corpus.documents.get('DEMO_payment_v1'), v2 = corpus.documents.get('DEMO_payment_v2');
  assert.equal(corpus.validOn(v1, '2026-05-31'), true);
  assert.equal(corpus.validOn(v1, '2026-06-01'), false);
  assert.equal(corpus.validOn(v2, '2026-05-31'), false);
  assert.equal(corpus.validOn(v2, '2026-06-01'), true);
  assert.equal(corpus.validOn(v1, '2099-01-01'), false);
});

test('six synthetic freshness and access cases pass without changing the real corpus', () => assert.equal(runLab().passed, 6));

test('changed bytes, metadata-only changes, and passage corruption are distinguished', async () => {
  const dir = await temp(); await fixture(dir);
  const before = await loadCorpus(dir);
  await fixture(dir, false, rows => rows.map(row => row.doc_id === 'DEMO_payment_v1' ? { ...row, role: 'legal' } : row));
  const after = await loadCorpus(dir); assert.notEqual(before.fingerprint, after.fingerprint);
  const filename = path.join(dir, 'text/DEMO_payment_v1.txt');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('30 days', '90 days'));
  await assert.rejects(loadCorpus(dir), /checksum mismatch/);
  await fixture(dir);
  const passages = path.join(dir, 'passages.jsonl');
  await writeFile(passages, (await readFile(passages, 'utf8')).replace('30 days', '90 days'));
  await assert.rejects(loadCorpus(dir), /not in its named source section/);
});

test('path escapes, duplicate IDs, invalid labels and supersession cycles fail closed', async () => {
  const dir = await temp();
  await fixture(dir, false, rows => [...rows, rows[0]]);
  await assert.rejects(loadCorpus(dir), /duplicate/);
  await fixture(dir, false, rows => rows.map((r, i) => i === 0 ? { ...r, role: 'root' } : r));
  await assert.rejects(loadCorpus(dir), /metadata/);
  await fixture(dir, false, rows => rows.map((r, i) => i === 0 ? { ...r, supersedes: ['DEMO_dispute_v1'] } : i === 1 ? { ...r, supersedes: ['DEMO_payment_v1'] } : r));
  await assert.rejects(loadCorpus(dir), /Cycle/);
  const { manifests } = await fixture(dir);
  const outside = await temp(); await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(path.join(outside, 'secret.txt'), path.join(dir, 'escape.txt'));
  manifests[0].text_path = 'escape.txt';
  await writeFile(path.join(dir, 'manifest.jsonl'), manifests.map(r => JSON.stringify(r)).join('\n'));
  await assert.rejects(loadCorpus(dir), /escapes/);
});

test('request validation rejects impossible dates, unknown roles, gold fields and malformed inputs', () => {
  assert.equal(isDate('2026-02-29'), false); assert.equal(isDate('2024-02-29'), true);
  const base = { id: 'x', question: 'Payment limits?', role: 'public', as_of: '2026-09-07' };
  for (const bad of [null, [], { ...base, role: 'constructor' }, { ...base, as_of: '2026-02-31' }, { ...base, gold_answer: 'injected' }, { ...base, id: '' }, { ...base, question: ' ' }]) assert.throws(() => validateQuestion(bad));
  assert.equal(validateQuestion(base).role, 'public');
});
