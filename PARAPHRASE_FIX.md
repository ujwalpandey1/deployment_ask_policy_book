# Paraphrase retrieval fix — 7 September 2026

The previous implementation could reject a correct question solely because it did not repeat the policy's vocabulary. That was an implementation limitation, not a requirement of OP-05. The fix uses the existing `.env` key; no additional credential or admin token is required for the local demo.

## What changed

1. **Meaning-based retrieval.** The supplied corpus is embedded with `text-embedding-3-small`, using 512 dimensions. Queries use the same embedding model; vector similarity complements BM25/TF-IDF. A relevant candidate can reach generation with zero exact keyword overlap.
2. **Adaptive evidence selection.** Preserve the original evidence for usable lexical matches. Use semantic recovery when lexical retrieval misses, or once after a valid model abstention with a different evidence pack. Broadly replacing every evidence pack regressed development accuracy, so that experiment was not retained.
3. **Protected semantic candidates.** Weak incidental keywords are downweighted, and two high-ranking semantic matches cannot be crowded out by repeated title/date boilerplate. Exact duplicate snippets are skipped.
4. **Contiguous, balanced excerpts.** Recovery reserves room for multiple sources and can select a later relevant window. Every quote remains one contiguous span of its actual source section. Source title and date stay adjacent to each excerpt; evidence text is not summarized to save tokens.
5. **Observable refusals and spend.** The UI distinguishes a retrieval miss from model abstention. Total usage includes query embeddings and every recovery call, with a separate search breakdown. Provider/embedding failures are errors, never “not in the book.”

Permissions, effective dates, source checksums and citation verification still gate the answer. Both lexical and semantic access refusals take precedence. Invalid citations, disclosure failures and provider errors do not trigger a recovery attempt. Cached results and concurrent identical requests avoid duplicate embedding/generation charges.

## Focused live comparison

The 41 cases are hand-authored from the public source documents, not the held-out question set. Ten topics each have a canonical question and two differently worded questions. Eleven further cases exercise blocked roles, absent topics and a not-yet-effective policy. Expectations are used only by the test runner, never passed to the app or model.

| Check | Keyword-only baseline | Adaptive semantic recovery |
|---|---:|---:|
| Canonical questions | 10/10 | 10/10 |
| Paraphrases | 11/20 | 20/20 |
| Access, absence and date boundaries | 8/11 | 11/11 |
| Total | 29/41 | 41/41 |

Baseline: [raw run at 11:29:10](results/raw/paraphrases-lexical-2026-09-07T11-29-10-720Z.json). Final adaptive run: [raw run at 11:48:08](results/raw/paraphrases-semantic-2026-09-07T11-48-08-192Z.json). The latter checks expected facts/source documents and independently verifies citation membership, role and date. It is **not** an independent semantic-accuracy score or a guarantee for every future paraphrase. These cases were used during iteration. Provider outputs and semantic judgments are nondeterministic.

For example, all three questions below cite the same payment section and answer with the 60-day ceiling:

- “How many days ahead may a new one-off payment be scheduled at Harbour?”
- “At Harbour, how far into the future can I book a fresh repayment?”
- “Could Harbour set up a new debit three months from now, or is that too far away?”

The real Chromium journey checks these responses, opens the usage trace, and repeats the question as Public to verify access denial. [Screenshot](results/screenshots/semantic-paraphrase.png).

Full-development evaluation remains mixed: 117/119 answerable questions are covered, but only 103/119 are judged correct (86.55%, versus the earlier 88.24%). All 174 citations are verbatim and all six out-of-book questions are refused. Mean input usage is 1,139.29 tokens, above the 1,005 target; one blocked question is still answered. The final cold-answer-cache HTTP test completed 146 requests at concurrency 12 with zero errors and 3.128-second p95 latency. These results support the paraphrase fix, not full assignment qualification. [Detailed evaluation](EVALUATION.md).

## Reproduce

```bash
npm test                       # backend, retrieval, provider and state regressions; no paid calls
npm run test:e2e               # offline Chromium checks
npm run test:paraphrases       # 41 live cases; uses .env
npm run test:e2e:live          # real desktop/mobile/paraphrase journeys
npm run test:paraphrases -- --baseline  # current keyword-only ablation; failures are retained
```

`SEMANTIC_SEARCH=auto` is the default: on with a key in model mode, off in the offline preview. `SEMANTIC_SEARCH=off` explicitly selects keyword-only search. The same configured provider must support `/embeddings`. `SEMANTIC_CACHE_DIR` optionally overrides the default `DATA_DIR/semantic` cache location. A changed configuration requires a restart.

## Cost, cache and limits

The first public-corpus index used **39,828 input tokens in seven embedding calls**, costing **$0.00079656** at the observed official rate of $0.02 per million input tokens. The final 41-case adaptive run used 41 query-embedding calls costing **$0.00001330**; its total candidate cost, including 37 generation calls, was **$0.02115450**. Its observed in-process p95 was **2.32 seconds** at concurrency four. Other trials, full-development evaluation, browser/load tests and judge calls are additional. The upstream grader does not return token usage, so total testing spend remains unverified. [Official embedding model/rate documentation](https://developers.openai.com/api/docs/models/text-embedding-3-small), checked 2026-09-07.

The persistent cache binds the corpus fingerprint, provider, model, dimensions and each embedding input hash. Its vectors and checksum are validated; writes are atomic with restrictive permissions. Unchanged restarts do not re-embed the corpus, and reloads reuse unchanged content. A failed re-index leaves the previous complete snapshot active; pending requests cannot publish an answer from a replaced snapshot. Tests cover both boundaries and corrupted caches.

Corpus embedding is a privileged ingestion operation: the configured provider receives the indexed source text. Operators must approve that provider for their own documents. The shipped corpus is a public benchmark despite its synthetic `ops`/`legal` labels. The answer model and requester-facing API never receive restricted retrieved content. The embedding provider publishes no dated immutable snapshot for this identifier; independent pinning/rate review and provider-drift handling remain qualification limitations.

The book is still the supplied corpus, not general web knowledge. Follow-up messages must include their context because browser history is not a model conversation. Similarity is heuristic, not proof of entailment. Citation correctness, temporal interpretation and semantic access isolation still require evaluation; see [EVALUATION.md](EVALUATION.md) for full-development results and retained failures.
