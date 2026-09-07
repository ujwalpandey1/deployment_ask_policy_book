// Explicit development debugging only; never imported by the serving application.
// Input is a previously saved candidate run, not gold labels or expected answers.
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { PolicyEngine } from '../src/engine.js';
import { generate, verifyAnswer } from '../src/generation.js';
import { readJsonl } from '../src/util.js';

const filename = process.argv[2];
if (!filename || !/^results\/raw\/dev-[\w.-]+\.jsonl$/.test(filename)) throw new Error('Supply a saved development raw run.');
const selectedId = process.argv[3] === '--id' ? process.argv[4] : null;
const rows = (await readJsonl(filename)).filter(r => selectedId ? r.id === selectedId : r.error === 'evidence_verification_failed');
const config = { ...loadConfig(), cacheSize: 0 };
if (config.mode !== 'model') throw new Error('Diagnostic requires model mode.');
const diagnostics = [];
const engine = new PolicyEngine(config, { provider: async (cfg, request, evidence) => {
  const output = await generate(cfg, request, evidence);
  let error = null;
  try { verifyAnswer(output.result, evidence, engine.corpus, request, cfg.mode); }
  catch (failure) { error = failure.message; }
  diagnostics.push({ id: request.id, input: request, draft: output.result, evidence, error, usage: output.usage });
  console.log(JSON.stringify({ id: request.id, error, draft: error ? output.result : undefined }));
  return output;
} });
await engine.initialize();
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < rows.length) {
    const row = rows[next++];
    try { await engine.ask(row.input); }
    catch (error) { if (error.code !== 'evidence_verification_failed') console.log(JSON.stringify({ id: row.id, error: error.code || 'runtime_error' })); }
  }
}));
await mkdir('results/raw', { recursive: true });
const outputPath = `results/raw/diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
await writeFile(outputPath, JSON.stringify({ source_run: filename, evidence_scope: 'Development debugging, additional API calls; not a scoring run.', rows: diagnostics }, null, 2) + '\n');
console.log(JSON.stringify({ output: outputPath, requests: rows.length, recorded: diagnostics.length }));
