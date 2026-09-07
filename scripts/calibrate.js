import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { PolicyEngine } from '../src/engine.js';
import { percent, readJsonl } from '../src/util.js';

const engine = new PolicyEngine(loadConfig({ GENERATION_MODE: 'extractive' }));
await engine.initialize();
const rows = (await readJsonl('vendor/op05/questions_dev.jsonl')).map(q => ({ q, result: engine.retriever.retrieve(q.question, q.role, q.as_of) }));
const count = status => rows.filter(r => r.q.expected_status === status).length;
const curve = [0.23, 0.3, 0.4, 0.5, 0.55, 0.6].map(floor => {
  const predicted = rows.map(({ q, result: r }) => ({ q, status: r.blocked ? 'not_permitted' : r.sufficient && r.hits[0]?.coverage >= floor ? 'answered' : 'not_in_corpus' }));
  return { floor, coverage: percent(predicted.filter(r => r.q.expected_status === 'answered' && r.status === 'answered').length, count('answered')),
    ooc_refusal: percent(predicted.filter(r => r.q.expected_status === 'not_in_corpus' && r.status === 'not_in_corpus').length, count('not_in_corpus')),
    role_refusal: percent(predicted.filter(r => r.q.expected_status === 'not_permitted' && r.status === 'not_permitted').length, count('not_permitted')) };
});
const report = { timestamp: new Date().toISOString(), source: 'Development split only. No held-out inputs or labels used for threshold selection.',
  selection: '0.55 for conservative extractive preview. This fails qualification coverage. Model mode uses a separate semantic abstention decision; it is unmeasured.', curve };
await mkdir('results/raw', { recursive: true });
await writeFile('results/calibration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
