# Decision evidence

These notes are reconstructed from implementation and measured runs on 7 September 2026. Codex substantially authored the code, tests and documentation. The tests, official deterministic grader, local HTTP load run and screenshots were inspected in-session; the user has not been claimed to have independently reviewed them.

## 1. Source IDs as the model’s citation vocabulary

Hypothesis: a small model can select a source more cheaply and reliably than it can reproduce exact long quotes. Options were free-form citation generation followed by repair, or a structured evidence-ID plan whose quotes are assembled by the server. The constraint is the per-citation integrity check plus a tight output budget.

We chose the ID plan. The local verifier rejects invented IDs, wrong sections, altered text, invalid dates and unauthorized documents. All four development runs emit citations that pass the upstream verbatim checker. This says nothing by itself about semantic support. We would reconsider if a measured model run frequently needs precise subspans to make each citation support the answer; the next option is server-enumerated sentence spans, not unconstrained quote repair. Evidence: generation tests and [EXPERIMENT_LOG.md](EXPERIMENT_LOG.md), runs beginning at 10:19 UTC.

## 2. Local lexical retrieval with a strict preview, not a passing offline claim

Hypothesis: a small shipped corpus makes CPU lexical retrieval sufficient as a first stage. Options were BM25/TF-IDF with no embedding infrastructure, or dense retrieval plus a learned reranker. With no model credential available, the observable constraint was independent reproducibility and measuring the retrieval/refusal boundary before adding another paid component.

The initial hybrid finds a gold passage in its top six for 94.12% of answerable dev questions, but quotes related passages for five of six OOC questions. Raising extraction coverage to 0.55 refuses all six and collapses answer coverage to 29.41%. This failure changed the product boundary: extraction is an explicitly labeled conservative preview, while model-assisted synthesis requires separate measurement. Live measurements were subsequently completed; see EVALUATION.md. We did not change qualification targets or report retrieval recall as accuracy.

That replacement condition occurred when the user tried natural-language paraphrases. The keyword-only path passed 11/20 hand-authored paraphrases, despite passing their ten canonical counterparts. We added metered semantic retrieval, protected semantic candidate slots, weak-keyword weighting and balanced exact excerpts. The final focused regression passed 20/20 paraphrases, 10/10 canonical questions and 11/11 boundary checks. These are development regressions used during iteration, not independent held-out proof. Costs, model-identifier limitations and failed trials are documented in [PARAPHRASE_FIX.md](PARAPHRASE_FIX.md). Offline behavior remains available explicitly.

## 3. Explicit temporal metadata and whole-snapshot publication

Hypothesis: version errors are state/invalidation errors as much as generation errors. Options were updating index rows in place, a versioned immutable snapshot with one publication pointer, or an external database/vector store with transactional revisions. The constraint is a small corpus and a published stop/replace/restart interface.

We chose immutable in-memory snapshots whose fingerprint includes roles and relationships as well as source bytes. Unchanged token maps are reused, but statistical state is rebuilt. A request interrupted by a refresh discards the old answer and retries; a second competing refresh produces a retryable error. A corrupted refresh leaves the prior index intact and reports failure. Explicit `supersedes` defines authority; matching titles or later publication dates alone do not.

Tests exposed a reload-report key collision, then confirmed history, withdrawals, role-only updates and a reload during generation. The actual HTTP restart rehearsal changes fictional values and checks historical and access behavior. We would switch to persistent transactional indexing if corpus size or multiple serving processes make whole-snapshot rebuilds/ownership impractical. Evidence: engine tests and [results/freshness_rehearsal.json](results/freshness_rehearsal.json).

## Scope of verification

The live follow-up exposed a fourth decision: whether an unsupported optional arithmetic receipt should suppress an otherwise source-cited answer. Keeping it as a hard gate caused 19 first-run failures; schema/prompt constraints alone left 15. We separated the boundaries: unsupported receipts are withheld with an explicit warning and are never marked verified, while citation, role and integrity failures still block release. Numeric/date correctness remains a semantic evaluation obligation. This is an availability/verification tradeoff, not a claim that an unverified calculation became correct.

Concise, question-specific answers and a model-only route for strong but low-coverage matches improved development accuracy from 0.8151 to 0.8824 and temporal accuracy from 0.7368 to 0.8947. No per-question answers or labels were embedded in inference. These interventions were chosen using the public development split; the small-sample results do not establish unseen performance.

The code-quality workflow prompted review of cache identity, audit serialization/ownership, output projection, provider failure accounting, date comparison races and restricted metadata. The code-qa workflow exercised the narrow primitives first, then HTTP/authentication, actual restart behavior and browser journeys. These are implementation checks, not a substitute for semantic policy review.
