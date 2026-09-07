import { performance } from 'node:perf_hooks';
import { loadCorpus } from './corpus.js';
import { Retriever, packEvidence } from './retrieval.js';
import { emptyUsage, extract, generate, verifyAnswer } from './generation.js';
import { addUsage } from './usage.js';
import { SemanticIndex, embed } from './semantic.js';
import { AppError, sha256, stableStringify, validateQuestion, requestId, canRead } from './util.js';

const REFUSALS = Object.freeze({
  not_permitted: 'You are not permitted to access the information needed to answer this question. Please contact an authorized colleague.',
  not_in_corpus: 'I could not find sufficient evidence in the available policy book to answer this question. Please refer it to a policy owner.',
});

class Semaphore {
  constructor(max) { this.max = max; this.active = 0; this.queue = []; }
  async run(fn) {
    if (this.active >= this.max) {
      if (this.queue.length >= this.max * 4) throw new AppError('busy', 'The policy desk is busy. Please retry shortly.', 503);
      await new Promise((resolve, reject) => {
        const waiter = { resolve: () => { clearTimeout(waiter.timer); resolve(); } };
        waiter.timer = setTimeout(() => { this.queue.splice(this.queue.indexOf(waiter), 1); reject(new AppError('busy', 'The policy desk is busy. Please retry shortly.', 503)); }, 10000);
        this.queue.push(waiter);
      });
    } else this.active++;
    try { return await fn(); }
    finally { if (this.queue.length) this.queue.shift().resolve(); else this.active--; }
  }
}

export class PolicyEngine {
  #state;
  #cache = new Map();
  #inflight = new Map();
  #reload = null;

  constructor(config, { audit = null, provider = generate, embedder = embed } = {}) {
    this.config = config; this.audit = audit; this.provider = provider; this.embedder = embedder;
    this.semaphore = new Semaphore(config.concurrency);
  }

  get corpus() { return this.#state?.corpus; }
  get retriever() { return this.#state?.retriever; }
  get semanticSearch() { return !!this.#state?.semantic; }

  async initialize() { return this.reload(); }

  async reload() {
    if (this.#reload) return this.#reload;
    this.#reload = (async () => {
      const start = performance.now();
      const corpus = await loadCorpus(this.config.corpusDir);
      if (corpus.fingerprint === this.corpus?.fingerprint) return { changed: false, indexing_ms: performance.now() - start, fingerprint: corpus.fingerprint };
      const retriever = new Retriever(corpus, { mode: this.config.retrieval, previous: this.retriever });
      const built = this.config.semanticSearch && this.config.retrieval !== 'baseline'
        ? await SemanticIndex.build(this.config, retriever, { previous: this.#state?.semantic, embedder: this.embedder }) : null;
      const indexingMs = performance.now() - start;
      const diff = this.#state ? diffCorpus(this.corpus, corpus) : { added: corpus.documents.size, modified: 0, removed: 0 };
      // A complete validated snapshot is published in a single synchronous assignment.
      this.#state = { corpus, retriever, semantic: built?.index, indexingMs };
      this.#cache.clear();
      return { changed: true, ...diff, indexing_ms: indexingMs, index_cost_usd: built?.usage.cost_usd ?? (built ? null : 0),
        semantic: built ? { usage: built.usage, cache_hit: built.cache_hit, reused_chunks: built.reused, artifact_build_usage: built.index.indexUsage } : null,
        reused_chunks: retriever.reused, fingerprint: corpus.fingerprint };
    })();
    try { return await this.#reload; } finally { this.#reload = null; }
  }

  async #compute(request, state) {
    const start = performance.now();
    let usage = emptyUsage(), semanticScores = null;
    const trace = [{ stage: 'Scope & date', detail: `Access checked for ${request.role}; effective on ${request.as_of}.`, ms: Math.round(performance.now() - start) }];
    if (state.semantic) {
      const semantic = await this.semaphore.run(() => state.semantic.search(request.question, this.embedder));
      semanticScores = semantic.scores; usage = addUsage(usage, semantic.usage);
      trace.push({ stage: 'Meaning-based search', detail: 'Semantic similarity combined with keyword search. Only permitted, date-valid passages can reach the answer model.', ms: Math.round(performance.now() - start) });
    }
    const semanticRetrieval = semanticScores ? state.retriever.retrieve(request.question, request.role, request.as_of, 6, semanticScores) : null;
    const lexical = state.retriever.retrieve(request.question, request.role, request.as_of);
    // Long hypothetical questions dilute term coverage despite a strong match.
    // The model still decides semantic answerability; extraction keeps its gate.
    const eligible = result => result?.sufficient || (this.config.mode === 'model' && result?.hits[0]?.matched >= 2 && result.hits[0].coverage >= 0.20 && result.hits[0].cosine >= 0.15);
    let retrieval = eligible(lexical) ? lexical : semanticRetrieval || lexical;
    let strategy = retrieval === lexical ? 'lexical-primary' : 'semantic-recovery';
    let status = lexical.blocked || semanticRetrieval?.blocked ? 'not_permitted' : !eligible(retrieval) ? 'not_in_corpus' : 'answered';
    if (status === 'answered' && this.config.mode === 'extractive' && retrieval.hits[0].coverage < this.config.extractiveFloor) status = 'not_in_corpus';
    let output = null;
    let refusalReason = status === 'not_permitted' ? 'access_restricted' : status === 'not_in_corpus' ? 'no_relevant_evidence' : null;
    let evidence = status === 'answered' ? packEvidence(retrieval.hits, this.config.contextChars, { question: request.question, balanced: strategy === 'semantic-recovery' }) : [];
    if (status === 'answered') {
      // Keep established precise evidence intact. Only an abstention can trigger
      // one semantic recovery attempt; errors and failed verification never do.
      for (let attempt = 0; attempt < 2; attempt++) {
        trace.push({ stage: attempt ? 'Semantic recovery' : 'Evidence retrieval', detail: `${evidence.length} permitted passages selected (${strategy}).`, ms: Math.round(performance.now() - start) });
        let draft;
        if (this.config.mode === 'model') {
          let generated;
          try { generated = await this.semaphore.run(() => this.provider(this.config, request, evidence)); }
          catch (error) { if (error instanceof AppError) error.usage = addUsage(usage, error.usage || emptyUsage()); throw error; }
          draft = generated.result; usage = addUsage(usage, generated.usage);
        } else draft = extract(evidence);
        try { output = verifyAnswer(draft, evidence, state.corpus, request, this.config.mode); }
        catch { throw new AppError('evidence_verification_failed', 'An answer could not be verified against permitted source evidence. Please retry or consult a policy owner.', 503, usage); }
        if (output || strategy !== 'lexical-primary' || !eligible(semanticRetrieval) || attempt) break;
        const recovery = packEvidence(semanticRetrieval.hits, this.config.contextChars, { question: request.question, balanced: true });
        const identity = items => stableStringify(items.map(e => [e.doc_id, e.section, e.text]));
        if (identity(recovery) === identity(evidence)) break;
        retrieval = semanticRetrieval; strategy = 'semantic-recovery'; evidence = recovery;
      }
      if (!output) { status = 'not_in_corpus'; refusalReason = 'evidence_insufficient'; }
      else if (output.checks.arithmetic_receipts_withheld) trace.push({ stage: 'Arithmetic review needed',
        detail: 'An optional calculation receipt was unsupported and withheld. Independently review the numeric/date interpretation; source citations were still checked.',
        ms: Math.round(performance.now() - start) });
    }
    trace.push({ stage: status === 'answered' ? 'Evidence verification' : 'Answer boundary',
      detail: status === 'answered' ? 'Source sections, exact quotes, permissions and effective dates checked.' : status === 'not_permitted' ? 'Access is required; no source content disclosed.'
        : refusalReason === 'evidence_insufficient' ? 'The answer model found insufficient support in the retrieved excerpts. This is not proof that the full book lacks the answer.'
          : 'Search did not find sufficiently relevant evidence for this role and date; the answer model was not called.',
      ms: Math.round(performance.now() - start) });
    return { status, answer: output?.answer || REFUSALS[status], citations: output?.citations || [],
      statements: output?.statements || [], calculations: output?.calculations || [],
      meta: { mode: this.config.mode, as_of: request.as_of, corpus_version: state.corpus.fingerprint,
        refusal_reason: refusalReason, retrieval: { method: state.semantic ? 'semantic+lexical' : 'lexical', strategy,
          sections: status === 'not_permitted' ? [] : retrieval.hits.map(h => h.passage.passage_id), packed_sections: evidence.map(e => e.section) },
        checks: output?.checks || null, trace, usage, indexing_ms: state.indexingMs, cache_hit: false } };
  }

  async ask(input) {
    const request = validateQuestion(input);
    if (!this.#state) throw new AppError('not_ready', 'The index is not ready.', 503);
    const start = performance.now();
    const traceId = requestId();
    let billed = emptyUsage();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const state = this.#state;
        // Preserve case and punctuation: an identifier or quoted phrase can be case-sensitive.
        const key = sha256(stableStringify({ question: request.question, role: request.role, as_of: request.as_of,
          corpus: state.corpus.fingerprint, model: this.config.model, mode: this.config.mode, retrieval: this.config.retrieval,
          semantic: state.semantic?.identity || null, contextChars: this.config.contextChars }));
        let output, reused = false;
        if (this.#cache.has(key)) {
          output = this.#cache.get(key); reused = true;
          this.#cache.delete(key); this.#cache.set(key, output);
        } else if (this.#inflight.has(key)) {
          reused = true;
          try { output = await this.#inflight.get(key); }
          catch (error) {
            // The leader meters the one failed provider call. Followers do not
            // duplicate its spend simply because they shared the failed promise.
            throw new AppError(error.code || 'internal_error', error instanceof AppError ? error.message : 'The shared request failed.', error.status || 503, emptyUsage());
          }
        } else {
          const task = this.#compute(request, state);
          this.#inflight.set(key, task);
          try {
            output = await task;
            billed = addUsage(billed, output.meta.usage);
            if (this.#state === state && this.config.cacheSize > 0) {
              this.#cache.set(key, output);
              if (this.#cache.size > this.config.cacheSize) this.#cache.delete(this.#cache.keys().next().value);
            }
          } finally { this.#inflight.delete(key); }
        }
        if (this.#state !== state) continue;
        const result = structuredClone(output);
        result.id = request.id; result.latency_ms = Math.round((performance.now() - start) * 100) / 100;
        result.meta.usage = billed; result.meta.cache_hit = reused; result.meta.trace_id = traceId;
        result.cost_usd = billed.cost_usd;
        if (this.audit) {
          result.meta.receipt = await this.audit.append({ kind: 'answer', trace_id: traceId, request_id: request.id,
            question_sha256: sha256(request.question), role: request.role, as_of: request.as_of, status: result.status,
            corpus_version: state.corpus.fingerprint, citations: result.citations.map(c => ({ doc_id: c.doc_id, section: c.section })),
            answer_sha256: sha256(result.answer), usage: billed, latency_ms: result.latency_ms, cache_hit: reused });
        }
        // Reload may have completed while the durable audit write was pending.
        if (this.#state !== state) continue;
        return result;
      }
      throw new AppError('corpus_changing', 'The policy book changed while answering. Please retry against the updated book.', 503);
    } catch (error) {
      const totalUsage = addUsage(billed, error.usage || emptyUsage());
      if (this.audit) await this.audit.append({ kind: 'error', trace_id: traceId, request_id: request.id, question_sha256: sha256(request.question),
        role: request.role, as_of: request.as_of, code: error.code || 'internal_error', usage: totalUsage });
      if (error instanceof AppError) error.usage = totalUsage;
      throw error;
    }
  }

  visibleAudit(role) {
    return (this.audit?.recent() || []).filter(row => canRead(role, row.role)
      && (row.citations || []).every(c => this.corpus.documents.has(c.doc_id) && canRead(role, this.corpus.documents.get(c.doc_id).role)))
      .slice(-80).reverse();
  }
}

function diffCorpus(a, b) {
  let added = 0, changed = 0, removed = 0;
  for (const [id, doc] of b.documents) {
    if (!a.documents.has(id)) added++;
    else if (stableStringify(doc) !== stableStringify(a.documents.get(id))) changed++;
  }
  for (const id of a.documents.keys()) if (!b.documents.has(id)) removed++;
  return { added, modified: changed, removed };
}
