import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMBEDDING, loadConfig } from '../src/config.js';
import { embed, SemanticIndex, chunkKey } from '../src/semantic.js';
import { Retriever, packEvidence } from '../src/retrieval.js';
import { PolicyEngine } from '../src/engine.js';
import { labCorpus } from '../src/lab.js';
import { loadCorpus } from '../src/corpus.js';
import { emptyUsage, extract } from '../src/generation.js';
import { addUsage } from '../src/usage.js';
import { AppError } from '../src/util.js';
import { temp, config, fixture, query } from './helpers.js';

const vector = axis => Array.from({ length: EMBEDDING.dimensions }, (_, i) => i === axis ? 1 : 0);
const fakeEmbed = async (_cfg, inputs) => {
  const usage = { input_tokens: inputs.length * 10, output_tokens: 0, cost_usd: inputs.length * 0.0000002, calls: 1, model: EMBEDDING.model };
  return { vectors: inputs.map(s => vector(/one-off|book a debit/i.test(s) ? 0 : /unicorn/.test(s) ? 2 : 1)), usage: { ...usage, embeddings: usage } };
};
const paraphrase = 'How far into the future can I book a debit?';

test('semantic search uses the existing key in model mode; preview and explicit opt-out remain offline', () => {
  assert.equal(loadConfig({ LLM_API_KEY: 'fake-key' }).semanticSearch, true);
  assert.equal(loadConfig({ LLM_API_KEY: 'fake-key', SEMANTIC_SEARCH: 'off' }).semanticSearch, false);
  assert.equal(loadConfig({ LLM_API_KEY: 'fake-key', GENERATION_MODE: 'extractive' }).semanticSearch, false);
  assert.equal(loadConfig({ LLM_API_KEY: 'fake-key', RETRIEVAL_MODE: 'baseline' }).semanticSearch, false);
  assert.throws(() => loadConfig({ SEMANTIC_SEARCH: 'on' }), /requires/);
  assert.throws(() => loadConfig({ SEMANTIC_SEARCH: 'invalid' }), /SEMANTIC_SEARCH/);
});

test('embedding adapter validates identity, dimensions and indices, and meters real usage', async () => {
  const cfg = await config();
  let body;
  const response = { model: EMBEDDING.model, usage: { prompt_tokens: 10 }, data: [{ index: 1, embedding: vector(1) }, { index: 0, embedding: vector(0) }] };
  const result = await embed(cfg, ['one', 'two'], { fetcher: async (url, options) => {
    assert.ok(url.endsWith('/embeddings')); assert.equal(options.redirect, 'error'); body = JSON.parse(options.body);
    return Response.json(response);
  } });
  assert.equal(body.dimensions, 512); assert.equal(body.model, EMBEDDING.model); assert.equal(body.encoding_format, 'float');
  assert.deepEqual(result.vectors, [vector(0), vector(1)]);
  assert.ok(Math.abs(result.usage.cost_usd - 0.0000002) < 1e-15); assert.equal(result.usage.embeddings.calls, 1);
  for (const invalid of [null, { ...response, model: 'other' }, { ...response, data: response.data.slice(0, 1) },
    { ...response, data: [response.data[0], response.data[0]] }, { ...response, data: [{ index: 0, embedding: [] }, response.data[0]] },
    { ...response, data: [{ index: 0, embedding: vector(-1) }, response.data[0]] }]) {
    await assert.rejects(embed(cfg, ['one', 'two'], { fetcher: async () => Response.json(invalid) }), { code: 'semantic_invalid' });
  }
  await assert.rejects(embed(cfg, ['one'], { fetcher: async () => { throw new Error('secret'); } }), error => error.code === 'semantic_unavailable' && error.usage.calls === 1 && error.usage.cost_usd === null && !error.message.includes('secret'));
});

test('content-addressed index survives restart, reuses unchanged text, and rejects corruption', async () => {
  const cfg = await config({ semanticCacheDir: await temp() });
  let batches = 0;
  const embedder = async (...args) => { batches++; return fakeEmbed(...args); };
  const original = new Retriever(labCorpus(false));
  const first = await SemanticIndex.build(cfg, original, { embedder });
  assert.equal(batches, 1); assert.equal(first.usage.calls, 1);
  const restart = await SemanticIndex.build(cfg, original, { embedder });
  assert.equal(batches, 1); assert.equal(restart.usage.calls, 0); assert.equal(restart.cache_hit, true);
  const changed = await SemanticIndex.build(cfg, new Retriever(labCorpus(true)), { previous: first.index, embedder });
  assert.ok(changed.reused > 0); assert.equal(batches, 2);
  const filename = path.join(cfg.semanticCacheDir, (await readdir(cfg.semanticCacheDir)).find(s => s.includes(original.corpus.fingerprint)));
  const bytes = JSON.parse(await readFile(filename, 'utf8')); bytes.entries[0].vector[0] += 0.1;
  await writeFile(filename, JSON.stringify(bytes));
  await assert.rejects(SemanticIndex.build(cfg, original, { embedder }), { code: 'semantic_cache_invalid' });
  assert.equal(batches, 2);
});

test('semantic retrieval recovers a zero-keyword paraphrase without leaking blocked or expired evidence', async () => {
  const retriever = new Retriever(labCorpus(true)), cfg = await config({ semanticCacheDir: await temp() });
  const { index } = await SemanticIndex.build(cfg, retriever, { embedder: fakeEmbed });
  const { scores } = await index.search(paraphrase, fakeEmbed);
  const legacy = retriever.retrieve(paraphrase, 'ops', '2026-09-07');
  assert.equal(legacy.sufficient, false);
  const found = retriever.retrieve(paraphrase, 'ops', '2026-09-07', 6, scores);
  assert.equal(found.sufficient, true); assert.equal(found.hits[0].matched, 0);
  assert.equal(found.hits[0].doc.doc_id, 'DEMO_payment_v2');
  assert.equal(retriever.retrieve(paraphrase, 'ops', '2025-09-07', 6, scores).hits[0].doc.doc_id, 'DEMO_payment_v1');
  const denied = retriever.retrieve(paraphrase, 'public', '2026-09-07', 6, scores);
  assert.equal(denied.blocked, true); assert.deepEqual(denied.hits, []);
  assert.doesNotMatch(JSON.stringify(denied), /DEMO_|45 days|payment/);
  assert.ok(scores.has(chunkKey(found.hits[0])));
});

test('incidental keywords and boilerplate cannot evict the strongest semantic candidates', async () => {
  const retriever = new Retriever(await loadCorpus('vendor/op05/corpus'));
  const values = { s00000: 0.41, s00001: 0.45, s00002: 0.61, s00003: 0.49, s00004: 0.56, s00005: 0.53, s00006: 0.44, s00007: 0.39 };
  const scores = new Map(retriever.entries.map(e => [chunkKey(e), e.doc.doc_id === 'HARBOUR_internal_servicing_policy' ? values[e.passage.passage_id.split('#')[1]] || 0 : 0]));
  const result = retriever.retrieve('At Harbour, how far into the future can I book a fresh repayment?', 'ops', '2026-09-07', 6, scores);
  assert.ok(result.hits.slice(0, 3).some(h => h.passage.passage_id.endsWith('#s00002')));
  assert.equal(retriever.retrieve('At Harbour, how far into the future can I book a fresh repayment?', 'public', '2026-09-07', 6, scores).blocked, true);
});

test('balanced packing finds later relevant text, reserves other sources, and preserves exact contiguous quotes', () => {
  const texts = [`${'Background information for readers. '.repeat(80)}\nThe special zebra obligation ends in 45 days.\n${'Further detail. '.repeat(80)}`,
    'Another supporting section. '.repeat(40), 'A third applicable condition. '.repeat(40)];
  const hits = texts.map((text, i) => ({ passage: { text, passage_id: `doc#s${i}` }, doc: { doc_id: 'doc', title: 'Policy', role: 'public', effective_date: '2020-01-01' }, coverage: 0.5, score: 1 }));
  const packed = packEvidence(hits, 1800, { question: 'When does the special zebra obligation end?', balanced: true });
  assert.ok(packed.length >= 3); assert.ok(packed.reduce((n, e) => n + e.text.length, 0) <= 1800);
  assert.match(packed[0].text, /45 days/);
  for (const [i, e] of packed.entries()) assert.ok(texts[i].includes(e.text));
});

async function setup(provider = async (_cfg, _req, evidence) => ({ result: extract(evidence), usage: { ...emptyUsage(), model: 'generator', calls: 1, input_tokens: 20 } }), embedder = fakeEmbed) {
  const dir = await temp(); await fixture(dir);
  const cfg = await config({ corpusDir: dir, mode: 'model', semanticSearch: true, semanticCacheDir: await temp() });
  const engine = new PolicyEngine(cfg, { provider, embedder }); await engine.initialize();
  return { engine, dir };
}

test('semantic and generation calls coalesce together, and cache hits incur neither charge', async () => {
  const { engine } = await setup();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => engine.ask(query({ id: `semantic-${i}`, question: paraphrase }))));
  assert.equal(results.reduce((n, r) => n + r.meta.usage.calls, 0), 2);
  assert.equal(results.reduce((n, r) => n + (r.meta.usage.embeddings?.calls || 0), 0), 1);
  assert.equal(results.filter(r => r.meta.cache_hit).length, 11);
  assert.equal(results[0].status, 'answered'); assert.equal(results[0].meta.refusal_reason, null);
  assert.equal((await engine.ask(query({ question: paraphrase }))).meta.usage.calls, 0);
  const denied = await engine.ask(query({ question: paraphrase, role: 'public' }));
  assert.equal(denied.status, 'not_permitted'); assert.equal(denied.meta.usage.calls, 1);
  assert.deepEqual(denied.meta.retrieval.sections, []);
  assert.doesNotMatch(JSON.stringify(denied), /DEMO_|30 days/);
});

test('retrieval misses, model abstentions and embedding outages are distinguishable', async () => {
  const { engine } = await setup(async () => ({ result: { decision: 'abstain', statements: [], calculations: [] }, usage: { ...emptyUsage(), calls: 1 } }));
  const absent = await engine.ask(query({ question: 'unicorn' }));
  assert.equal(absent.meta.refusal_reason, 'no_relevant_evidence'); assert.equal(absent.meta.usage.calls, 1);
  const abstain = await engine.ask(query({ question: paraphrase }));
  assert.equal(abstain.meta.refusal_reason, 'evidence_insufficient'); assert.equal(abstain.meta.usage.calls, 2);
  engine.embedder = async () => { throw new AppError('semantic_unavailable', 'Search unavailable.', 503, { ...emptyUsage(), cost_usd: null, calls: 1 }); };
  await assert.rejects(engine.ask(query({ question: `${paraphrase} Please.` })), { code: 'semantic_unavailable' });
});

test('a reload during query embedding cannot publish newly restricted policy content', async () => {
  let release, began;
  const entered = new Promise(r => { began = r; }), pending = new Promise(r => { release = r; });
  let pause = true;
  const embedder = async (cfg, inputs) => {
    if (inputs.length === 1 && inputs[0] === paraphrase && pause) { pause = false; began(); await pending; }
    return fakeEmbed(cfg, inputs);
  };
  const { engine, dir } = await setup(undefined, embedder);
  const answer = engine.ask(query({ question: paraphrase })); await entered;
  await fixture(dir, true, rows => rows.map(r => /DEMO_payment/.test(r.doc_id) ? { ...r, role: 'legal' } : r));
  await engine.reload(); release();
  const result = await answer;
  assert.equal(result.status, 'not_permitted'); assert.deepEqual(result.citations, []);
  assert.equal(result.meta.usage.calls, 3);
  assert.doesNotMatch(JSON.stringify(result), /30 days|45 days|DEMO_payment/);
});

test('a failed generation retains embedding spend, including unknown costs', async () => {
  const { engine } = await setup(async () => { throw new AppError('provider_unavailable', 'Unavailable.', 503, { ...emptyUsage(), input_tokens: null, cost_usd: null, calls: 1 }); });
  await assert.rejects(engine.ask(query({ question: paraphrase })), error => error.usage.calls === 2 && error.usage.embeddings.calls === 1 && error.usage.cost_usd === null && error.usage.input_tokens === null);
  assert.equal(addUsage(emptyUsage(), { ...emptyUsage(), cost_usd: null }).cost_usd, null);
});

test('a failed semantic re-index leaves the complete previous snapshot usable', async () => {
  const { engine, dir } = await setup();
  const before = engine.corpus.fingerprint;
  await fixture(dir, true);
  engine.embedder = async () => { throw new AppError('semantic_unavailable', 'Unavailable.', 503, { ...emptyUsage(), calls: 1, cost_usd: null }); };
  await assert.rejects(engine.reload(), { code: 'semantic_unavailable' });
  assert.equal(engine.corpus.fingerprint, before);
  engine.embedder = fakeEmbed;
  const result = await engine.ask(query({ question: paraphrase }));
  assert.match(result.answer, /30 days/); assert.equal(result.meta.corpus_version, before);
});

test('only an abstention can trigger one different, permission-filtered recovery attempt', async () => {
  let calls = 0;
  const { engine } = await setup(async (_cfg, _req, evidence) => {
    calls++;
    return { result: calls === 1 ? { decision: 'abstain', statements: [], calculations: [] } : extract(evidence), usage: { ...emptyUsage(), calls: 1 } };
  });
  const original = engine.retriever.retrieve.bind(engine.retriever);
  engine.retriever.retrieve = (...args) => {
    const found = original(...args);
    if (!args[4]) return found;
    // A different permitted excerpt represents a semantic recovery candidate.
    return { ...found, hits: found.hits.map(h => ({ ...h, passage: { ...h.passage, text: h.passage.text.slice(h.passage.text.indexOf(' ')).trim() } })) };
  };
  const result = await engine.ask(query());
  assert.equal(result.status, 'answered'); assert.equal(calls, 2);
  assert.equal(result.meta.usage.calls, 3); assert.equal(result.meta.usage.embeddings.calls, 1);
  assert.equal(result.meta.retrieval.strategy, 'semantic-recovery');
  assert.ok(result.meta.trace.some(t => t.stage === 'Semantic recovery'));
  calls = 0;
  engine.provider = async () => { calls++; throw new AppError('provider_unavailable', 'Unavailable.', 503, { ...emptyUsage(), calls: 1 }); };
  await assert.rejects(engine.ask(query({ question: `${query().question} Please.` })), { code: 'provider_unavailable' });
  assert.equal(calls, 1);
});
