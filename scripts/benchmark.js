import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { readJsonl, percentile, sha256 } from '../src/util.js';

const url = process.env.SERVICE_URL || 'http://127.0.0.1:4600';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error('Use a local SERVICE_URL.');
const headers = { 'Content-Type': 'application/json', ...(process.env.RUNNER_TOKEN ? { Authorization: `Bearer ${process.env.RUNNER_TOKEN}` } : {}) };
const source = await readJsonl('vendor/op05/questions_dev.jsonl');
const mode = await (await fetch(`${url}/api/meta?role=legal`, { headers })).json();
if (!mode.mode) throw new Error('Cannot inspect server mode.');
let next = 0; const rows = [], start = performance.now();
await Promise.all(Array.from({ length: 12 }, async () => {
  while (next < source.length) {
    const q = source[next++], began = performance.now();
    const input = { id: `load-${q.id}`, question: q.question, role: q.role, as_of: q.as_of };
    try {
      const r = await fetch(`${url}/api/ask`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
      const result = await r.json();
      rows.push({ id: q.id, question_sha256: sha256(q.question), http_status: r.status, latency_ms: performance.now() - began,
        status: result.status || null, strategy: result.meta?.retrieval?.strategy || null,
        error: result.error?.code || null, trace_id: result.meta?.trace_id || result.error?.request_id || null,
        cache_hit: result.meta?.cache_hit ?? false, usage: result.meta?.usage ?? null });
    } catch { rows.push({ id: q.id, http_status: 0, latency_ms: performance.now() - began, error: 'request_failed' }); }
  }
}));
const report = { timestamp: new Date().toISOString(), mode: mode.mode, model: mode.model, retrieval: mode.retrieval, concurrency: 12, requests: rows.length,
  errors: rows.filter(r => r.http_status !== 200).length, cache_hits: rows.filter(r => r.cache_hit).length,
  p50_ms: percentile(rows.map(r => r.latency_ms), .5), p95_ms: percentile(rows.map(r => r.latency_ms), .95),
  total_ms: performance.now() - start, evidence_scope: 'Observed local HTTP including audit. Not independent Linux/gateway qualification.', rows };
await mkdir('results/raw', { recursive: true });
await writeFile(`results/raw/load-${Date.now()}.json`, JSON.stringify(report, null, 2) + '\n');
await writeFile('results/latency_bench.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (report.errors) process.exitCode = 1;
