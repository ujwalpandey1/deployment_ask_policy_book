import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { labRows, runLab } from '../src/lab.js';
import { sha256 } from '../src/util.js';
import { ROOT } from '../src/config.js';

const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-atlas-restart-'));
async function writeCorpus(updated) {
  await mkdir(path.join(dir, 'text'), { recursive: true }); const manifest = [], passages = [];
  for (const row of labRows(updated)) {
    const { text, ...metadata } = row; const section = `${row.doc_id}#s1`; const bytes = `[${section}]\n${text}\n`;
    manifest.push({ ...metadata, source_url: 'https://example.com/synthetic-policy', text_path: `text/${row.doc_id}.txt`, sha256: sha256(bytes) });
    passages.push({ passage_id: section, doc_id: row.doc_id, text }); await writeFile(path.join(dir, 'text', `${row.doc_id}.txt`), bytes);
  }
  await writeFile(path.join(dir, 'manifest.jsonl'), manifest.map(r => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(path.join(dir, 'passages.jsonl'), passages.map(r => JSON.stringify(r)).join('\n') + '\n');
}
const request = { id: 'restart-payment', question: 'How many days ahead may one-off payments be scheduled?', role: 'ops', as_of: '2026-09-07' };
const port = Number(process.env.REHEARSAL_PORT || 4604);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid REHEARSAL_PORT.');
async function boot() {
  const started = performance.now();
  const child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_MODE: 'demo', GENERATION_MODE: 'extractive',
      CORPUS_DIR: dir, DATA_DIR: path.join(dir, 'runtime') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-2000); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Rehearsal service did not become ready.')); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Rehearsal startup failed (${code}): ${stderr}`)); });
      child.stdout.on('data', bytes => { stdout += bytes.toString(); if (stdout.includes('"event":"ready"')) { clearTimeout(timer); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}`;
    const ready = await fetch(`${url}/healthz`); if (!ready.ok) throw new Error('Health check did not pass.');
    const meta = await (await fetch(`${url}/api/meta?role=legal`)).json();
    return { child, url, indexing: { indexing_ms: meta.indexing_ms, startup_ms: performance.now() - started, fingerprint: meta.corpus_version, index_cost_usd: 0 } };
  } catch (error) { if (child.exitCode === null) child.kill('SIGTERM'); throw error; }
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
}
async function ask(url, payload) {
  const response = await fetch(`${url}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Rehearsal request failed: ${response.status}`);
  return response.json();
}
await writeCorpus(false);
const first = await boot(); let before;
try { before = await ask(first.url, request); } finally { await stop(first.child); }
await writeCorpus(true);
const second = await boot(); let after, historical, roleChange;
try {
  after = await ask(second.url, request);
  historical = await ask(second.url, { ...request, id: 'historical', as_of: '2025-09-07' });
  roleChange = await ask(second.url, { ...request, id: 'access-change', question: 'What is the specialist oversight escalation queue review frequency?' });
} finally { await stop(second.child); }
const lab = runLab();
const report = { timestamp: new Date().toISOString(), synthetic: true, interface: 'Actual service processes stopped/restarted against the same CORPUS_DIR and PORT, checked via HTTP healthz and ask',
  passed: lab.passed === lab.total && before.answer.includes('30 days') && after.answer.includes('45 days') && before.meta.corpus_version !== after.meta.corpus_version
    && historical.answer.includes('30 days') && roleChange.status === 'not_permitted',
  index_before: first.indexing, index_after: second.indexing, before, after, historical, role_change: roleChange, lab, fixture_directory: dir };
await mkdir('results/raw', { recursive: true });
await writeFile('results/freshness_rehearsal.json', JSON.stringify(report, null, 2) + '\n');
await writeFile(`results/raw/freshness-${Date.now()}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, cases: lab.total, before_version: before.meta.corpus_version, after_version: after.meta.corpus_version }, null, 2));
if (!report.passed) process.exitCode = 1;
