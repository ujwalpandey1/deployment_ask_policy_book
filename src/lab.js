import { Corpus } from './corpus.js';
import { Retriever, packEvidence } from './retrieval.js';
import { extract, verifyAnswer } from './generation.js';
import { normalize, sha256, stableStringify } from './util.js';

// Deliberately synthetic: these rules never enter the published challenge corpus.
export function labRows(updated = false) {
  const rows = [
    { doc_id: 'DEMO_payment_v1', title: 'Example payment scheduling policy', role: 'ops', effective_date: '2025-01-01', supersedes: [], text: 'One-off payments may be scheduled no more than 30 days ahead. Customer identity must be verified before scheduling a payment.' },
    { doc_id: 'DEMO_dispute_v1', title: 'Example dispute resolution policy', role: 'ops', effective_date: '2025-01-01', supersedes: [], text: 'Customer payment disputes must be resolved within 20 days of being raised. Acknowledge the dispute immediately.' },
    { doc_id: 'DEMO_waiver_v1', title: 'Example goodwill fee waiver policy', role: 'ops', effective_date: '2025-01-01', supersedes: [], text: 'An automated agent may approve a goodwill fee waiver up to 500 rupees. Larger goodwill fee waivers require manual review.' },
    { doc_id: 'DEMO_oversight', title: 'Example specialist oversight policy', role: updated ? 'legal' : 'ops', effective_date: '2025-01-01', supersedes: [], text: 'Specialist oversight escalation uses a sealed review queue. The specialist oversight queue is reviewed every 7 days.' },
  ];
  if (updated) rows.push(
    { doc_id: 'DEMO_payment_v2', title: 'Example payment scheduling policy, version 2', role: 'ops', effective_date: '2026-06-01', supersedes: ['DEMO_payment_v1'], text: 'One-off payments may be scheduled no more than 45 days ahead. Customer identity must be verified before scheduling a payment.' },
    { doc_id: 'DEMO_dispute_amendment', title: 'Example dispute resolution amendment', role: 'ops', effective_date: '2026-06-01', supersedes: ['DEMO_dispute_v1'], text: 'This amendment replaces the dispute resolution rule: customer payment disputes must be resolved within 10 days of being raised. Acknowledge the dispute immediately.' },
    { doc_id: 'DEMO_waiver_withdrawal', title: 'Example goodwill fee waiver withdrawal notice', role: 'ops', effective_date: '2026-06-01', supersedes: ['DEMO_waiver_v1'], text: 'Automated goodwill fee waivers are withdrawn. All goodwill fee waiver requests now require manual review.' },
  );
  return rows;
}

export function labCorpus(updated = false) {
  const docs = new Map(), passages = [];
  for (const row of labRows(updated)) {
    const section = `${row.doc_id}#s1`;
    const text = `[${section}]\n${row.text}\n`;
    docs.set(row.doc_id, Object.freeze({ ...row, text, normalized: normalize(text), sha256: sha256(text),
      source_url: 'https://example.com/synthetic-policy', text_path: `text/${row.doc_id}.txt`, passageIds: Object.freeze([section]) }));
    passages.push(Object.freeze({ doc_id: row.doc_id, passage_id: section, text: row.text, hash: sha256(row.text) }));
  }
  return new Corpus(docs, passages, sha256(stableStringify(labRows(updated))));
}

export function runLab() {
  const before = labCorpus(false), after = labCorpus(true);
  const cases = [
    { name: 'Superseding version', question: 'How many days ahead may one-off payments be scheduled?', role: 'ops', as_of: '2026-09-07', old: '30 days', expected: '45 days' },
    { name: 'Amended deadline', question: 'Within how many days must customer payment disputes be resolved?', role: 'ops', as_of: '2026-09-07', old: '20 days', expected: '10 days' },
    { name: 'Withdrawn permission', question: 'What is the automated goodwill fee waiver rule?', role: 'ops', as_of: '2026-09-07', old: '500 rupees', expected: 'withdrawn' },
    { name: 'Historical answer', question: 'How many days ahead may one-off payments be scheduled?', role: 'ops', as_of: '2025-09-07', old: '30 days', expected: '30 days' },
    { name: 'Access change', question: 'What is the specialist oversight escalation queue review frequency?', role: 'ops', as_of: '2026-09-07', old: '7 days', expected: 'not_permitted' },
    { name: 'Outside the book', question: 'How far away is the Andromeda galaxy?', role: 'legal', as_of: '2026-09-07', old: 'not_in_corpus', expected: 'not_in_corpus' },
  ];
  function answer(corpus, request) {
    const retrieval = new Retriever(corpus).retrieve(request.question, request.role, request.as_of);
    if (retrieval.blocked) return { status: 'not_permitted', answer: 'Access required.', citations: [] };
    if (!retrieval.sufficient) return { status: 'not_in_corpus', answer: 'Insufficient evidence.', citations: [] };
    const evidence = packEvidence(retrieval.hits);
    return { status: 'answered', ...verifyAnswer(extract(evidence), evidence, corpus, request, 'extractive') };
  }
  const matches = (result, expected) => ['not_permitted', 'not_in_corpus'].includes(expected) ? result.status === expected : result.status === 'answered' && result.answer.includes(expected);
  const rows = cases.map(c => {
    const a = answer(before, c), b = answer(after, c);
    return { name: c.name, question: c.question, as_of: c.as_of, before: c.name === 'Access change' ? { status: a.status, answer: 'Answer available to the original role.', citations: [] } : a,
      after: b, passed: matches(a, c.old) && matches(b, c.expected) };
  });
  return { synthetic: true, note: 'Local synthetic rehearsal. These are not the private update-pack results.', passed: rows.filter(r => r.passed).length, total: rows.length, cases: rows };
}
