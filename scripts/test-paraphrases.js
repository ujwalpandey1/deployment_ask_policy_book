import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadConfig, EMBEDDING } from '../src/config.js';
import { PolicyEngine } from '../src/engine.js';
import { normalize, canRead, percentile } from '../src/util.js';
import { addUsage, emptyUsage } from '../src/usage.js';
import { paraphraseCases } from '../tests/fixtures/paraphrases.js';

const baseline = process.argv.includes('--baseline');
const cfg = { ...loadConfig(), cacheSize: 0, semanticSearch: !baseline };
if (cfg.mode !== 'model' || !cfg.key) throw new Error('Live paraphrase tests require LLM_API_KEY in .env and model mode.');
const engine = new PolicyEngine(cfg);
const indexing = await engine.initialize();
const results = new Array(paraphraseCases.length);
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < paraphraseCases.length) {
    const i = next++, c = paraphraseCases[i], start = performance.now();
    let response = null, error = null, usage = null;
    try { response = await engine.ask({ id: c.id, question: c.question, role: c.role, as_of: c.as_of }); }
    catch (failure) { error = failure.code || 'runtime_error'; usage = failure.usage || null; }
    const checks = { status: response?.status === c.expected_status };
    if (c.expected_status === 'answered') {
      checks.expected_source = !!response?.citations.some(citation => citation.doc_id === c.document);
      checks.key_facts = (c.patterns || []).every(p => new RegExp(p, 'i').test(response?.answer || ''));
    }
    checks.citation_integrity = !!response && response.citations.every(citation => {
      const doc = engine.corpus.documents.get(citation.doc_id);
      const passage = engine.corpus.passages.find(p => p.passage_id === citation.section && p.doc_id === citation.doc_id);
      return !!doc && !!passage && canRead(c.role, doc.role) && engine.corpus.validOn(doc, c.as_of)
        && normalize(passage.text).includes(normalize(citation.quote));
    });
    if (c.expected_status !== 'answered') checks.no_disclosure = !!response && response.citations.length === 0
      && !/HARBOUR_internal|servicing policy|2,?500|sixty|60 days/i.test(response.answer);
    results[i] = { id: c.id, input: { question: c.question, role: c.role, as_of: c.as_of }, expected_status: c.expected_status,
      family: c.family, variant: c.variant ?? null, checks, passed: !error && Object.values(checks).every(Boolean),
      elapsed_ms: performance.now() - start, response, error, usage: response?.meta.usage || usage };
    console.log(JSON.stringify({ id: c.id, passed: results[i].passed, status: response?.status, error }));
  }
}));
const stamp = new Date().toISOString(), mode = baseline ? 'lexical' : 'semantic';
const usage = results.reduce((total, row) => addUsage(total, row.usage || { ...emptyUsage(), cost_usd: null }), emptyUsage());
const summarize = rows => ({ total: rows.length, passed: rows.filter(r => r.passed).length });
const report = { timestamp: stamp, mode, scope: 'Hand-authored paraphrase regression set; expected facts and sources checked, not an independent semantic rubric score. No held-out questions used.',
  model: cfg.model, embedding: baseline ? null : EMBEDDING, corpus: engine.corpus.fingerprint, indexing,
  summary: { ...summarize(results), answerable: summarize(results.filter(r => r.expected_status === 'answered')),
    paraphrases: summarize(results.filter(r => r.variant > 0)), boundaries: summarize(results.filter(r => r.expected_status !== 'answered')),
    p95_ms: percentile(results.map(r => r.elapsed_ms), 0.95), usage }, results };
await mkdir('results/raw', { recursive: true });
const filename = `results/raw/paraphrases-${mode}-${stamp.replace(/[:.]/g, '-')}.json`;
await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
await writeFile(`results/paraphrases_${mode}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: filename, ...report.summary }, null, 2));
if (report.summary.passed !== report.summary.total) process.exitCode = 1;
