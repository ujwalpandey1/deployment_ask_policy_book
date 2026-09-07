# Verification handoff — 7 September 2026

**Engineering checks pass. Challenge qualification is not established.** The app was restarted with the user's existing API key and left running in model mode at http://127.0.0.1:4600. No admin/auth tokens are needed for this loopback-only demo.

## Checks actually run

| Check | Result | Reproduce / evidence |
|---|---|---|
| Backend, security, concurrency and HTTP regressions | **38 passed** | `npm test` |
| Offline browser E2E | **9 passed** | `npm run test:e2e`; generates local `results/browser-report/index.html` |
| Real-model desktop, mobile and paraphrase E2E | **3 passed** | `npm run test:e2e:live`; generates local `results/live-browser-report/index.html` |
| Source-derived live paraphrase regression | **41/41 passed** (20/20 paraphrases, 10/10 canonical, 11/11 boundaries) | `npm run test:paraphrases`; [before/after](PARAPHRASE_FIX.md) |
| Pinned upstream files | **51 verified** | `npm run verify:data` |
| Supersession, amendment, withdrawal, access and restart rehearsal | **Passed** | `npm run rehearse`; [artifact](results/freshness_rehearsal.json) |
| Isolated Linux/ARM64 container | **8 checks passed** | `npm run test:container`; [artifact](results/container-smoke.json) |
| Real-model cold-cache HTTP load, concurrency 12 | **146/146 HTTP 200; zero answer-cache hits; p95 3.128 s** | `npm run benchmark`; [artifact](results/latency_bench.json) |
| Official development evaluation | **146 cases; zero runtime/judge errors** | `npm run evaluate -- --judge`; [report](results/report_dev.json) |
| Historical lexical-only held-out prediction generation | **272 unique valid outputs; zero runtime errors** | [predictions](results/answers.jsonl); unscored, predates the semantic fix |
| Shareable code/test/result secret scan | **150 files checked; no configured secret values found** | Exact-value scan; `.env` itself was intentionally excluded |
| Final running-service check | **Ready; model mode; semantic+lexical retrieval** | HTTP 200 from `/healthz` and `/api/meta` on port 4600 |

Browser checks include exact-source inspection, JSON export contents, cache replay with zero additional generation calls, role changes during a pending response, recovery after an API outage, historical source-link dates, arithmetic warnings, document filters, timeline comparison, audit navigation, keyboard submission, mobile overflow and hostile-markup handling. Chromium was tested; this is not full cross-browser or accessibility certification.

The container test excludes `.env`, question sets and grader code from the serving image. It runs non-root, read-only, with no network/API key, one CPU and 256 MB memory. Only its uniquely named temporary container is stopped after testing. Docker Desktop remains available on the host.

## Meaningful defects repaired

- Historical comparison links now open the source at the compared date and exact section.
- Failed static-asset startup releases the audit ownership lease.
- Admin reload rejects arrays/primitives and accepts only an empty JSON object.
- Provider schemas enumerate only available evidence IDs and constrain statement/calculation shapes.
- Unsupported optional arithmetic receipts are withheld and visibly flagged; citation, role and integrity failures still block release.
- Question-specific concise answers and a strong-match model route reduce unsupported extra claims and false refusals.
- Evaluation generation time is separated from judge wall time, and unspecified sampling seeds are recorded honestly.
- Semantic recovery handles zero-keyword paraphrases, protects useful semantic candidates, and reserves context for multiple exact excerpts.
- Index corruption, embedding outages, snapshot changes during search, shared-call billing and recovery failures have dedicated regressions.
- Refusals distinguish a search miss from model abstention; an embedding or generation outage remains an explicit error.

## Results an evaluator should see

Latest development results: **98.32% coverage, 86.55% answer accuracy, 100% verbatim citations, 94.25% citation support, 100% OOC refusal on six cases**, and zero deterministically detected role violations. The final run used the unchanged official grader: 297 verdict calls, zero judge errors.

Two measured development targets remain below the bar: overall answer accuracy **86.55% vs 88%**, and input tokens **1,139.29 vs 1,005** per question. Contradiction accuracy is **100%**, temporal accuracy **94.74%**, and correct access refusal **95.24%**. Zero deterministic role violations does not certify semantic isolation: one role-blocked question was answered, as discussed in [EVALUATION.md](EVALUATION.md).

The focused paraphrase score improved from **11/20 to 20/20**, but overall accuracy is lower than the earlier 88.24% run. Quality review and full-regression testing caught two weaker approaches: always replacing lexical evidence, and compressing source metadata. The final implementation keeps established evidence and adds bounded semantic recovery. Provider and judge sampling vary; neither the focused success nor a single development comparison certifies all questions.

An earlier live HTTP run had one verifier rejection; it was preserved, not hidden by a retry. The final semantic-enabled cold-cache comparison passed. Earlier schema/arithmetic failures and OOC mistakes are also retained. The published corpus, gold answers and grader were not altered to improve scores.

Final dev candidate cost was **$0.08389814**: $0.083796 generation plus $0.00010214 query embeddings. Initial corpus embedding cost **$0.00079656** separately; unchanged restarts reuse it. Historical lexical held-out generation cost was $0.1318484. These are not total testing costs: earlier runs, diagnostics, browser/load requests and semantic grading are additional. Judge token usage is not exposed by the upstream grader, so complete spend remains unverified.

Before claiming qualification: address the two remaining measured bars and the blocked-question answer, perform semantic role review, obtain current-code private held-out/freshness scores, and reproduce cost/latency through the reviewer-controlled gateway. Publishing the implementation does not constitute a formal submission or qualification.

Start the review with [DEMO.md](DEMO.md). Detailed design and decisions: [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), [EXPERIMENT_LOG.md](EXPERIMENT_LOG.md).
