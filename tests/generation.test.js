import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, verifyAnswer, verifyCalculation, extract } from '../src/generation.js';
import { labCorpus } from '../src/lab.js';
import { Retriever, packEvidence } from '../src/retrieval.js';
import { config, query } from './helpers.js';

test('provider prompt includes only permitted evidence and uses exact budget snapshot plus schema', async () => {
  const corpus = labCorpus(true), req = query({ role: 'public', question: 'Payment limits?' });
  const retrieval = new Retriever(corpus).retrieve(req.question, req.role, req.as_of);
  assert.equal(retrieval.hits.length, 0);
  const cfg = await config(); let body;
  const evidence = [{ id: 'E1', text: 'Payment limit is 45 days.', title: 'Permitted policy', effective_date: '2026-01-01' }];
  const output = await generate(cfg, query(), evidence, { fetcher: async (_url, options) => {
    body = JSON.parse(options.body); assert.equal(options.redirect, 'error');
    return Response.json({ model: cfg.model, usage: { prompt_tokens: 40, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extract(evidence)) } }] });
  } });
  assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
  const schema = body.response_format.json_schema.schema;
  assert.equal(schema.properties.statements.maxItems, 3);
  assert.deepEqual(schema.properties.statements.items.properties.evidence_ids.items.enum, ['E1']);
  const operands = schema.properties.calculations.items.properties.operands;
  assert.equal(operands.minItems, 2); assert.equal(operands.maxItems, 2);
  assert.ok(operands.items.properties.source.enum.includes('question'));
  assert.equal(new RegExp(operands.items.properties.value.pattern).test('2026-01-01'), false);
  assert.match(body.messages[0].content, /Calculations are OPTIONAL/);
  assert.equal(body.temperature, undefined); assert.doesNotMatch(JSON.stringify(body.messages), /DEMO_oversight|sealed review/);
  assert.equal(output.usage.cost_usd, 0.000032);
});

test('snapshot mismatches, truncation, malformed JSON, missing usage and timeouts are explicit', async () => {
  const cfg = await config();
  const valid = { model: cfg.model, choices: [{ finish_reason: 'stop', message: { content: '{"decision":"abstain","statements":[],"calculations":[]}' } }] };
  const unknown = await generate(cfg, query(), [], { fetcher: async () => Response.json(valid) }); assert.equal(unknown.usage.cost_usd, null);
  await assert.rejects(generate(cfg, query(), [], { fetcher: async () => Response.json({ ...valid, model: 'other-model' }) }), { code: 'model_identity_mismatch' });
  await assert.rejects(generate(cfg, query(), [], { fetcher: async () => Response.json({ ...valid, choices: [{ finish_reason: 'length' }] }) }), { code: 'provider_incomplete' });
  await assert.rejects(generate(cfg, query(), [], { fetcher: async () => { throw new Error('secret provider address'); } }), { code: 'provider_unavailable' });
  await assert.rejects(generate(cfg, query(), [], { fetcher: async () => Response.json({ ...valid, choices: [{ finish_reason: 'stop', message: { content: 'bad' } }] }) }), { code: 'provider_invalid' });
  await assert.rejects(generate(cfg, query(), [], { fetcher: async () => Response.json(null) }), { code: 'provider_invalid' });
});

test('every excerpt retains its own entity and date metadata next to unchanged source text', async () => {
  const cfg = await config();
  const evidence = [1, 2].map(i => ({ id: `E${i}`, doc_id: 'same-document', title: 'A permitted source', effective_date: '2026-01-01', text: `Exact source excerpt ${i}.` }));
  let prompt;
  await generate(cfg, query(), evidence, { fetcher: async (_url, options) => {
    prompt = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ model: cfg.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extract(evidence)) } }] });
  } });
  assert.deepEqual(prompt.evidence.map(e => e.title), evidence.map(e => e.title));
  assert.deepEqual(prompt.evidence.map(e => e.effective_date), evidence.map(e => e.effective_date));
  assert.deepEqual(prompt.evidence.map(e => e.text), evidence.map(e => e.text));
});

test('source verification rejects altered quotes, unrelated sections and restricted output', () => {
  const corpus = labCorpus(true), req = query();
  const evidence = packEvidence(new Retriever(corpus).retrieve(req.question, req.role, req.as_of).hits);
  const draft = extract(evidence);
  assert.equal(verifyAnswer(draft, evidence, corpus, req).checks.quotes_verbatim, true);
  assert.throws(() => verifyAnswer(draft, [{ ...evidence[0], text: 'Invented wording' }], corpus, req), /Unverifiable/);
  assert.throws(() => verifyAnswer(draft, [{ ...evidence[0], section: 'DEMO_payment_v1#s1' }], corpus, req), /Unverifiable/);
  assert.throws(() => verifyAnswer({ ...draft, statements: [{ text: 'DEMO_oversight is the answer.', evidence_ids: ['E1'] }] }, evidence, corpus, req), /Restricted/);
  const untrustedExtra = { ...draft, statements: [{ ...draft.statements[0], unexpected: 'hidden instructions' }] };
  assert.equal(verifyAnswer(untrustedExtra, evidence, corpus, req).statements[0].unexpected, undefined);
});

test('decimal arithmetic is exact, source-bound, and never executes expressions', () => {
  const evidence = [{ id: 'E1', text: 'Payments of 0.1 and 0.2 rupees; the ceiling is 5,00,000 rupees.' }];
  const calculation = { operation: 'add', operands: [{ value: '0.1', source: 'E1' }, { value: '0.2', source: 'E1' }], unit: 'rupees' };
  assert.equal(verifyCalculation(calculation, evidence, '').result, '0.3');
  assert.throws(() => verifyCalculation({ ...calculation, operands: [{ value: '99', source: 'E1' }, calculation.operands[1]] }, evidence, ''), /absent/);
  assert.throws(() => verifyCalculation({ ...calculation, operation: 'eval' }, evidence, ''), /Invalid/);
  assert.throws(() => verifyCalculation({ ...calculation, operation: 'divide', operands: [{ value: '0.1', source: 'E1' }, { value: '0', source: 'question' }] }, evidence, '0'), /Division by zero/);
});

test('unsupported optional receipts are withheld and flagged without weakening citation checks', () => {
  const corpus = labCorpus(true), req = query();
  const evidence = packEvidence(new Retriever(corpus).retrieve(req.question, req.role, req.as_of).hits);
  const draft = { ...extract(evidence), calculations: [{ operation: 'add', operands: [{ value: '99999', source: 'E1' }, { value: '12345', source: 'question' }], unit: 'private untrusted content' }] };
  const answer = verifyAnswer(draft, evidence, corpus, req);
  assert.deepEqual(answer.calculations, []);
  assert.equal(answer.checks.arithmetic_verified, false);
  assert.equal(answer.checks.arithmetic_receipts_withheld, 1);
  assert.doesNotMatch(JSON.stringify(answer), /private untrusted content|99999/);
  assert.throws(() => verifyAnswer({ ...draft, statements: [{ text: 'Unverified answer', evidence_ids: ['E99'] }] }, evidence, corpus, req), /Unverifiable citation/);
});
