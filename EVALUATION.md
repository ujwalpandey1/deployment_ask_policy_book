# Evaluation and failure analysis

**No qualifying result is claimed.** The latest live development run uses the released 146-question split: 119 answerable, 21 role-blocked and 6 outside the corpus. Generation and the unchanged official semantic grader use `gpt-4.1-mini-2025-04-14`; retrieval now also uses `text-embedding-3-small`. The grader made 297 successful verdict calls with zero parsing errors. Results remain local development evidence, not independent qualification.

[results/report_dev.json](results/report_dev.json) is the latest official report. Original outputs, failures and token ledgers are retained under [results/raw](results/raw); [results/manifest.json](results/manifest.json) preserves every evaluation run. Latest development run: `dev-model-hybrid-2026-09-07T11-47-56-410Z`.

## Live model results

| Metric | Latest development result | Target | Outcome |
|---|---:|---:|---|
| Coverage | 117/119 = 0.9832 | ≥0.87 | Pass on dev |
| Answer accuracy | 103/119 = 0.8655 | ≥0.88 | **Fail** |
| Contradiction accuracy | 8/8 = 1.0000 | ≥0.88 | Pass on eight dev cases only |
| Temporal accuracy | 18/19 = 0.9474 | ≥0.88 | Pass on dev |
| Citation verbatim rate | 174/174 = 1.0000 | ≥0.92 | Pass on dev |
| Semantic citation support | 164/174 = 0.9425 | ≥0.82 | Pass on dev |
| Out-of-corpus refusal | 6/6 = 1.0000 | ≥0.95 | Pass on six dev cases only |
| OOC fabrication | 0, review complete | 0 | No fabrication found by this judge |
| Correct access refusal | 20/21 = 0.9524 | ≥0.87 | Pass on dev; one semantic disclosure risk remains |
| Detected role violations | 0 | 0 | Deterministic check only; semantic review remains incomplete |
| Mean input tokens | 1,139.29 | ≤1,005 | **Fail**, approximately 13.4% above budget; includes query embeddings/recovery |
| Mean output tokens | 82.64 | ≤743 | Within budget on dev |
| Cold-cache HTTP p95 | 3.128 seconds | ≤10.8 seconds | Local macOS measurement; independent matched-load check pending |
| Runtime/schema errors | 0/146 | Valid output for every request | Pass in this run |

The candidate consumed 166,337 input and 12,065 output tokens in 281 calls: **$0.08389814**. This comprises 135 generation calls ($0.083796 at the challenge's pinned rates) and 146 query-embedding calls ($0.00010214 at the disclosed embedding rate). The initial corpus index cost $0.00079656 separately; this run reused that cache without new indexing calls. These are not total testing costs. The unchanged judge does not report its token usage; its cost remains unknown here. Diagnostic, earlier evaluation, load and browser calls are additional. Provider sampling is nondeterministic and repeated runs can differ.

The official rubric is not overridden when a result appears debatable. `indiafinbench_TMP_013` is still answered instead of denied: a semantic disclosure risk despite zero deterministic overlap violations. Two answerable questions, `indiafinbench_NUM_107` and `indiafinbench_REG_167`, are still refused. Fourteen answered questions are judged incorrect. Full per-case and per-citation verdicts are in the report.

The paraphrase improvement is real on the authored regression set: **20/20 rewordings now pass, versus 11/20 in the lexical-only comparison**. Full-development results are mixed: coverage, contradiction, temporal and access-refusal scores improved over the 11:02 run, but overall accuracy is 86.55% versus 88.24%, and input usage is higher. This is not a statistically controlled attribution of every difference to retrieval; model and judge sampling can vary. Focused success must not be presented as full qualification. See [PARAPHRASE_FIX.md](PARAPHRASE_FIX.md).

### What the live interventions changed

| Run / intervention | Runtime errors | Coverage | Accuracy | Citation support | Temporal accuracy |
|---|---:|---:|---:|---:|---:|
| 10:48 initial real provider | 19 | 0.7647 | Not judged | Not judged | Not judged |
| 10:52 tighter schema/receipt instructions | 15 | 0.7983 | Not judged | Not judged | Not judged |
| 10:56 optional-receipt warning boundary | 0 | 0.9160 | 0.8151 | 0.8882 | 0.7368 |
| 11:02 concise answers + strong-match model route | 0 | 0.9664 | 0.8824 | 0.9181 | 0.8947 |
| 11:33 always-fused semantic evidence (not retained) | 0 | 0.9748 | 0.8403 | 0.9261 | 0.8421 |
| 11:41 adaptive recovery + compressed source metadata (not retained) | 0 | 0.9832 | 0.8571 | 0.9405 | 0.8421 |
| 11:47 adaptive recovery + per-excerpt source labels restored | 0 | 0.9832 | 0.8655 | 0.9425 | 0.9474 |

The first failures mainly attempted to encode dates, spelled-out numbers, converted percentages or intermediate values in a two-literal calculator. Schema constraints alone did not fix source-bound operand errors. Unsupported **optional receipts** are now withheld with an explicit UI/check warning; this is not arithmetic certification. Citation and permission failures still block answers. The 10:52 run also fabricated an OOC citation; that failed experiment is retained.

The second intervention removed unrequested extra history/adjacent claims and let sufficiently strong long-question matches reach the model instead of failing solely on term coverage. The runtime never receives gold labels or expected answers. The prompt schema enumerates only the evidence IDs packed for that request.

Always replacing established evidence with fused rankings regressed the full development score despite passing focused paraphrase checks. Adaptive recovery now preserves usable lexical evidence and permits at most one different semantic evidence pack after a valid abstention. A separate source-metadata compression trial produced an OOC entity/metric substitution (NBFC versus credit rating agency); that optimization was reverted. The final run again refused all six OOC cases. This does not establish that formatting alone caused or cured the sampled error. All trials and costs are retained.

## Historical no-key preview

The initial build had no credential and used the official grader with `--no-judge`; semantic fields in those runs remain null. Its conservative preview is still available and is not promoted as a passing answer engine. The table below records that original operating point, not the latest model score.

| Metric | Current preview | Challenge target | Interpretation |
|---|---:|---:|---|
| Coverage | 35/119 = 0.2941 | ≥0.87 | Fails; most questions need semantic interpretation or a less conservative answerability gate |
| Citation verbatim rate | 1.0000 | ≥0.92 | Every emitted citation passed the published checker |
| Out-of-corpus refusal | 6/6 = 1.0000 | ≥0.95 | Observed on only six development cases; no general guarantee |
| Fabricated citations on OOC | 0 | 0 | No citations emitted on these six cases |
| Correct role-blocked refusal | 18/21 = 0.8571 | ≥0.87 | Fails narrowly; existence classification remains heuristic |
| Detected role violations | 0 | 0 | Deterministic overlap/citation checks only, not semantic certification |
| Answer correctness | Unmeasured | ≥0.88 overall and per required slice | Needs the pinned judge and live generation |
| Citation support | Unmeasured | ≥0.82 | Source membership alone does not establish entailment |
| Private update pack | Unavailable | Required | Local synthetic rehearsal passes, but is different evidence |

## Interventions and what they changed

| Run | Coverage | OOC refusal | Role refusal | Gold passage recall@1 / @6 |
|---|---:|---:|---:|---:|
| Initial TF-IDF, permissive extraction | 0.9412 | 0.1667 | 0.7619 | 0.6639 / 0.9412 |
| Initial hybrid, permissive extraction | 0.9580 | 0.1667 | 0.8095 | 0.6723 / 0.9412 |
| Hybrid + strict extraction gate | 0.2941 | 1.0000 | 0.8095 | 0.6723 / 0.9412 |
| Document priors + refined access gate | 0.2941 | 1.0000 | 0.8571 | 0.6807 / 0.9412 |

All four runs have 1.0 verbatim citation rate and zero detected role violations. The initial five unsupported answers are deliberately preserved; they are not omitted as “demo” failures. The refusal gate prevents those particular extractions but introduces many false refusals. This is a measured failure of a lexical-only answerability strategy, not proof that a model will fix it. The final implementation’s baseline comparison can be rerun with the same threshold; earlier runs are historical snapshots of development.

The development-only threshold sweep is [results/calibration.json](results/calibration.json). At 0.4 it covers 90/119 answerable cases and refuses 5/6 OOC questions. At 0.55 it covers only 35/119 and refuses 6/6. We chose the latter for a preview that clearly identifies itself as extraction. Selecting on six OOC examples overfits easily; future threshold tuning needs additional independently written negative questions.

## Contradiction and temporal slices

| Slice | Answerable cases | Gold passage recall@1 | Gold passage recall@6 | Preview coverage | Semantic accuracy |
|---|---:|---:|---:|---:|---|
| Contradiction | 8 | 0.7500 | 1.0000 | 0.2500 | null |
| Temporal | 19 | 0.8947 | 1.0000 | 0.4211 | null |
| Numerical | 27 | 0.6296 | 0.9630 | 0.1481 | null |
| Regulatory interpretation | 63 | 0.6508 | 0.9365 | 0.3175 | null |

These are historical preview retrieval diagnostics against published gold section IDs, not accuracy. A packed context can omit a lower-ranked passage despite recall@6. Contradiction passages often include both “Passage A” and “Passage B”; extraction preserves them without pretending to infer a winner. Temporal answers require both manifest-level version filtering and interpretation of dates/conditions inside the source. Semantic interpretation was unmeasured during the no-key phase; the live results above now report it separately.

The two answerable internal-policy development questions both cite `HARBOUR_internal_servicing_policy#s00000` in their gold metadata. That source section contains the introduction, while the requested hardship/payment rules appear in `#s00004` and `#s00002`. Thus literal gold-section recall is 0/2 even when the actual rule is retrieved. The upstream data is unmodified. This is a dataset observation, not a reason to substitute scores or lower the bars.

## Failure taxonomy

1. **Unsupported topical extraction.** A question about licensing, CCTV retention, or commercial-paper tenor shares terms with a different rule. The permissive baseline quotes that related passage. Five of six OOC questions fail. A stronger extraction threshold removes those outputs but does not solve semantic answerability.
2. **False refusal.** The conservative preview gate rejects paraphrases, hypothetical arithmetic and long legal questions because relevant terms cover too little of the question. Preview count: 84 answerable questions. Adaptive semantic recovery reduces this to two in the latest live run, but does not eliminate retrieval/interpretation failures.
3. **Wrong first passage.** A topical passage can beat the exact provision. Document priors and the named-regulation-year hint improved historical preview recall@1 slightly. Ten answered preview questions chose a first passage different from the gold section. Some differences are real errors; the internal gold-section inconsistency is a separate caveat. Protected semantic candidates and balanced recovery excerpts address displacement, not entailment.
4. **Missed access refusal.** The historical preview labeled three blocked questions absent instead of “access required.” The latest model run correctly denies 20 of 21, but answers one blocked question. Strict filtering of labeled restricted excerpts does not prove semantic isolation when another source has related wording; complete semantic role review remains necessary.
5. **Version invalidation / concurrency.** Synthetic tests intentionally change a rule during a pending generation, change a visibility label with unchanged bytes, and fail a reload. Snapshot checks, metadata-bound fingerprints, and a validated atomic swap handle these exercised paths.
6. **Provider/verification failure.** Mocked wrong snapshot IDs, malformed JSON, truncation, unknown token usage, invented evidence IDs and timeouts produce explicit service errors. Live failures and corrective experiments are recorded above; invalid source citations are never silently converted into an absence refusal.

## Load and freshness evidence

[results/latency_bench.json](results/latency_bench.json): the final semantic-plus-lexical live model load run at 11:53:57 UTC has 146 local HTTP requests at concurrency 12, zero errors and zero cache hits; p50 2,031.98 ms and p95 **3,128.12 ms**. The earlier lexical model run had p95 2,684.58 ms. An earlier live load run had one `evidence_verification_failed` response and p95 3,216.26 ms. Its raw report and audit event are preserved; a single diagnostic replay passed, so the exact failed draft was not recovered and its cause is not overstated. The original extraction-only load run had p95 53.28 ms. These are macOS measurements including audit I/O, not reviewer-controlled matched-load Linux model qualification. Cold cache here means no answer-cache hits; the corpus embedding index is already built.

[results/container-smoke.json](results/container-smoke.json) confirms the application ran on Linux/ARM64 in Docker Desktop as UID 1000, with one CPU, 256 MB memory, a read-only application filesystem, no network and no API key. Readiness, authentication, citations, role refusal, public catalog isolation, and exclusion of `.env`/gold/grader files passed. This is an offline container test, not model throughput evidence.

[results/freshness_rehearsal.json](results/freshness_rehearsal.json) exercises actual service stop/restart on one `CORPUS_DIR`: a payment window changes from 30 to 45 fictional days, a historical answer remains 30, and a changed access label prevents disclosure. A separate six-case synthetic suite includes amendment, withdrawal and OOC behavior. These values are examples, not real Harbour rules and not the private pack.

What can break under a new update: missing relationship metadata, partial amendments whose affected sections are not identified, source encodings/section markers that differ from the contract, a source hash not updated with its text, or an effective date incorrectly supplied by the policy owner. Integrity and format defects stop loading; semantic metadata errors can still produce a wrong “current” interpretation. The operator needs an approval/checklist at ingestion and a regression set for each changed rule.

## Unseen document types

The ingestion contract accepts UTF-8 text with manifest metadata and named passage sections. It does not silently pretend to understand a PDF scan, spreadsheet layout, image, handwritten note or multilingual legal nuance. Unsupported input fails validation or remains out of the book until an adapter preserves the source bytes, section mapping, role and effective dates. Tables already rendered as source text can be retrieved but need semantic evaluation. Add new formats behind a reviewable parser and golden section/provenance tests before relying on them.

## Remaining verification

The earlier lexical-only implementation generated 272 unique, schema-valid unlabelled held-out predictions with zero runtime errors in `heldout-model-hybrid-2026-09-07T11-08-37-017Z`. [results/answers.jsonl](results/answers.jsonl) is that historical prediction artifact, **not predictions from the current semantic-recovery code**. No held-out score was computed and no held-out case was used for subsequent tuning. Held-out inputs were not inspected or rerun during the paraphrase fix. This historical run used 209 generation calls, 245,573 input tokens and 21,012 output tokens ($0.1318484 at the fixed rates).

Address the overall accuracy shortfall, input-token overrun and remaining blocked-question answer; collect complete generation, embedding and judge usage through a metered gateway; measure matched-load Linux model latency; request the private update-pack run; conduct semantic role review. The automated judge uses the same pinned model family as generation and is not independent human review. Held-out inputs are public and unlabelled; no held-out score is claimed and no private gold is available or used. Current-code held-out qualification remains pending.
