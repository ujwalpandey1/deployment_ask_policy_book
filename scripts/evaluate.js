import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { loadConfig, MODEL_PINS, EMBEDDING, ROOT } from '../src/config.js';
import { PolicyEngine } from '../src/engine.js';
import { readJsonl, sha256, percent, percentile } from '../src/util.js';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const split = option('--split', 'dev');
if (!['dev', 'heldout'].includes(split)) throw new Error('--split must be dev or heldout');
const retrieval = option('--retrieval', 'hybrid');
if (!['baseline', 'hybrid'].includes(retrieval)) throw new Error('--retrieval must be baseline or hybrid');
const config = { ...loadConfig(), retrieval, cacheSize: 0 };
const concurrency = Number(option('--concurrency', '12'));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Invalid concurrency.');
const apiUrl = option('--url', null);
if (apiUrl && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl)) throw new Error('Local benchmark URL required; remote service use needs a reviewed adapter.');
const inputPath = path.join(ROOT, `vendor/op05/questions_${split}.jsonl`);
const questions = await readJsonl(inputPath);
const timestamp = new Date().toISOString();
const runId = `${split}-${config.mode}-${retrieval}-${timestamp.replace(/[:.]/g, '-')}`;
const outDir = path.join(ROOT, 'results');
await mkdir(path.join(outDir, 'raw'), { recursive: true });
const rawPath = `results/raw/${runId}.jsonl`;
const engine = new PolicyEngine(config);
const indexing = await engine.initialize();
const outputs = new Array(questions.length), raw = new Array(questions.length), diagnostics = new Array(questions.length);
let next = 0;
const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < questions.length) {
    const i = next++, q = questions[i];
    // The generator only sees the four public input fields. Tags and gold are
    // exclusively evaluator-side, never passed to candidate code or prompts.
    const input = { id: q.id, question: q.question, role: q.role, ...(q.as_of ? { as_of: q.as_of } : {}) };
    const asked = performance.now();
    try {
      let answer;
      if (apiUrl) {
        const res = await fetch(`${apiUrl}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.RUNNER_TOKEN ? { Authorization: `Bearer ${process.env.RUNNER_TOKEN}` } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(config.timeoutMs + 15000) });
        const data = await res.json();
        if (!res.ok) throw Object.assign(new Error(data.error?.message || 'HTTP failure'), { code: data.error?.code, usage: null });
        answer = data;
      } else answer = await engine.ask(input);
      outputs[i] = { id: answer.id, status: answer.status, answer: answer.answer, citations: answer.citations.map(({ doc_id, section, quote }) => ({ doc_id, section, quote })), cost_usd: answer.cost_usd, latency_ms: performance.now() - asked };
      raw[i] = { id: q.id, input, response: answer, elapsed_ms: performance.now() - asked, error: null };
    } catch (error) {
      // Preserve failures in the denominator; never mislabel outages as abstention.
      outputs[i] = { id: q.id, status: 'error', answer: '', citations: [], cost_usd: error.usage?.cost_usd ?? null, latency_ms: performance.now() - asked };
      raw[i] = { id: q.id, input, response: null, elapsed_ms: performance.now() - asked, error: error.code || 'runtime_error', usage: error.usage || null };
    }
    if (split === 'dev') {
      const retrieved = engine.retriever.retrieve(input.question, input.role, input.as_of);
      const wanted = new Set((q.gold_citations || []).map(c => c.section));
      const top = raw[i].response?.meta.retrieval?.sections || retrieved.hits.map(h => h.passage.passage_id);
      diagnostics[i] = { id: q.id, tags: q.tags, expected_status: q.expected_status, status: outputs[i].status,
        retrieval_at_1: wanted.size ? wanted.has(top[0]) : null,
        retrieval_at_6: wanted.size ? top.slice(0, 6).some(id => wanted.has(id)) : null,
        all_gold_at_6: wanted.size ? [...wanted].every(id => top.slice(0, 6).includes(id)) : null,
        retrieval_method: raw[i].response?.meta.retrieval?.method || 'lexical',
        lexical_top_coverage: retrieved.hits[0]?.coverage ?? null, lexical_top_cosine: retrieved.hits[0]?.cosine ?? null,
        failure: raw[i].error || (outputs[i].status !== q.expected_status ? (q.expected_status === 'not_in_corpus' ? 'unsupported_answer' : q.expected_status === 'not_permitted' ? 'missed_access_refusal' : 'false_refusal') : wanted.size && !wanted.has(top[0]) ? 'wrong_first_passage' : null) };
    }
  }
}));
const generationMs = performance.now() - start;
const jsonl = data => data.map(row => JSON.stringify(row)).join('\n') + '\n';
await writeFile(path.join(ROOT, rawPath), jsonl(raw));
await writeFile(path.join(outDir, `answers_${split}.jsonl`), jsonl(outputs));
if (split === 'heldout') await writeFile(path.join(outDir, 'answers.jsonl'), jsonl(outputs));
await writeFile(path.join(outDir, 'raw', `${runId}.answers.jsonl`), jsonl(outputs));
const usageRows = raw.map(row => ({ id: row.id, mode: config.mode, ...(row.response?.meta.usage || row.usage || { input_tokens: null, output_tokens: null, cost_usd: null, calls: null }), error: row.error }));
await writeFile(path.join(outDir, 'raw', `${runId}.ledger.jsonl`), jsonl(usageRows));
let report = null, analysis = null;
if (split === 'dev') {
  const reportPath = path.join(outDir, 'raw', `${runId}.grader.json`);
  const graderArgs = ['vendor/op05/grader.py', '--pred', `results/answers_${split}.jsonl`, '--gold', inputPath, '--corpus', path.join(config.corpusDir, 'manifest.jsonl'), '--report', reportPath];
  if (!args.includes('--judge')) graderArgs.push('--no-judge');
  if (args.includes('--judge') && !(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.JUDGE_MODEL)) throw new Error('Semantic grading requires LLM_BASE_URL, LLM_API_KEY and JUDGE_MODEL; generation artifacts have been preserved.');
  const grader = spawnSync(process.env.PYTHON || 'python3', graderArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  if (grader.status !== 0) throw new Error(`Official grader failed: ${grader.stderr || grader.error}`);
  report = JSON.parse(await readFile(reportPath, 'utf8'));
  await writeFile(path.join(outDir, 'report_dev.json'), JSON.stringify(report, null, 2) + '\n');
  const answerable = diagnostics.filter(d => d.expected_status === 'answered');
  const metrics = rows => ({ n: rows.length, recall_at_1: percent(rows.filter(r => r.retrieval_at_1).length, rows.length), recall_at_6: percent(rows.filter(r => r.retrieval_at_6).length, rows.length),
    coverage: percent(rows.filter(r => r.status === 'answered').length, rows.length) });
  analysis = { run_id: runId, interpretation: 'Development retrieval diagnostics, not semantic correctness. Baseline uses TF-IDF cosine with the same permission/date/citation boundaries.',
    overall: metrics(answerable), slices: Object.fromEntries(['contradiction_detection', 'temporal_reasoning', 'numerical_reasoning', 'regulatory_interpretation', 'internal_policy'].map(tag => [tag, metrics(answerable.filter(r => r.tags.includes(tag)))])),
    failure_taxonomy: diagnostics.filter(r => r.failure).reduce((a, r) => { a[r.failure] = (a[r.failure] || 0) + 1; return a; }, {}), cases: diagnostics };
  await writeFile(path.join(outDir, 'raw', `${runId}.analysis.json`), JSON.stringify(analysis, null, 2) + '\n');
}
const total = key => usageRows.some(r => r[key] === null) ? null : usageRows.reduce((n, r) => n + r[key], 0);
const run = { run_id: runId, seed: null, sampling_note: 'No provider seed is set; repeated model runs may differ.', timestamp, status: raw.some(r => r.error) ? 'completed_with_errors' : 'completed',
  model: config.mode === 'model' ? config.model : 'none-extractive', mode: config.mode, retrieval, split, concurrency,
  configuration: { context_chars: config.contextChars, output_token_cap: config.outputTokens, extractive_coverage_floor: config.extractiveFloor, cache_size: 0,
    semantic_search: engine.semanticSearch, evidence_strategy: engine.semanticSearch ? 'lexical-primary with bounded semantic recovery' : 'lexical', source_metadata: 'per-excerpt' },
  provider: config.mode === 'model' ? new URL(config.baseUrl).host : null,
  input_sha256: sha256(await readFile(inputPath)), corpus_sha256: engine.corpus.fingerprint,
  raw_path: rawPath, questions: questions.length, errors: raw.filter(r => r.error).length,
  indexing: { ...indexing, scope: engine.semanticSearch ? 'Local CPU plus separately metered corpus embeddings; persistent cache and incremental reuse' : 'local CPU, no API calls' },
  embeddings: engine.semanticSearch ? { ...EMBEDDING, reproducibility: 'Provider identifier has no dated immutable snapshot; independently verified pricing/pinning remains pending.' } : null,
  usage: { input_tokens: total('input_tokens'), output_tokens: total('output_tokens'), cost_usd: total('cost_usd'), api_calls: total('calls'),
    embeddings: engine.semanticSearch ? { input_tokens: usageRows.reduce((n, r) => r.embeddings?.input_tokens === null || n === null ? null : n + (r.embeddings?.input_tokens || 0), 0),
      api_calls: usageRows.reduce((n, r) => n + (r.embeddings?.calls || 0), 0), cost_usd: usageRows.reduce((n, r) => r.embeddings?.cost_usd === null || n === null ? null : n + (r.embeddings?.cost_usd || 0), 0) } : null,
    rate_source: config.mode === 'model' ? MODEL_PINS[config.model].source : null, rate_provenance: config.mode === 'model' ? 'Generation: Season 1 fixed rates, vendor/upstream/MODELS.md. Embeddings when enabled: official rate verified 2026-09-07, disclosed separately. Totals include query embeddings; corpus indexing is separate.' : 'No generation API calls' },
  latency: { scope: apiUrl ? 'local HTTP, includes audit' : 'in-process, excludes HTTP and audit', p95_ms: percentile(outputs.map(o => o.latency_ms), 0.95), total_ms: generationMs },
  evaluation_wall_ms: performance.now() - start,
  summary: report?.summary || null,
};
let existing = { claimed: {}, runs: [] };
try { existing = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const summary = report?.summary;
const claimed = summary ? { coverage: summary.answered_rate_on_answerable, citation_verbatim_rate: summary.citation_verbatim_rate, ooc_refusal_rate: summary.ooc_refusal_rate, detected_role_violations: summary.role_violations } : existing.claimed;
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ problem: 'OP-05', claimed, qualification: 'not_established',
  pending: ['Qualification bar review and independent reproduction', 'Semantic role review', 'Private held-out label grading', 'Private freshness update pack', 'Gateway-attested complete cost and matched-load Linux latency'],
  runs: [...existing.runs, run] }, null, 2) + '\n');
console.log(JSON.stringify({ run_id: runId, ...report?.summary, retrieval: analysis?.overall, failures: analysis?.failure_taxonomy, usage: run.usage, latency: run.latency }, null, 2));
