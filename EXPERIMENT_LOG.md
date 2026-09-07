# Experiment log — 7 September 2026

Entries are reconstructed from raw artifacts and tool output in this session. Times below are UTC. Initial runs through 10:29 used no key or generation model; the later live follow-up is recorded below. Significant Codex assistance is disclosed in README and DECISIONS.

| Time | Experiment | Observation | Evidence |
|---|---|---|---|
| 10:19:02 | TF-IDF with permissive extraction | 112/119 answerable covered, 1/6 OOC refused, 16/21 correct access refusals; five unsupported OOC citations | `results/raw/dev-extractive-baseline-2026-09-07T10-19-02-860Z.*` |
| 10:19:15 | BM25/cosine fusion | Coverage rises to 114/119; top-1 section recall rises to 80/119; OOC failures remain five | `results/raw/dev-extractive-hybrid-2026-09-07T10-19-15-458Z.*` |
| 10:22:28 | Strict extraction coverage threshold, 0.55 | 6/6 OOC refusals, but only 35/119 answerable covered; a clear failed coverage experiment | `results/raw/dev-extractive-hybrid-2026-09-07T10-22-28-238Z.*` |
| 10:23:47 | Corpus document priors, acronym expansions, refined access threshold | 81/119 top-1 section retrieval, 112/119 top-6; 18/21 correct access refusals. Coverage remains 35/119 | `results/raw/dev-extractive-hybrid-2026-09-07T10-23-47-549Z.*` |
| 10:26:45 | Local HTTP concurrency 12, cold cache | 146 requests, zero errors/cache hits, 53.28 ms p95; extraction only | `results/latency_bench.json` |
| 10:29:09 | Development threshold sweep | No tested lexical threshold clears both coverage and OOC-refusal requirements | `results/calibration.json` |

Every development run above had 1.0 citation verbatim rate and zero detected role violations. Those deterministic metrics do not establish semantic answer/citation correctness. The last three runs explicitly record configuration; the first two used 3600 context characters, a 650-token configured output cap, no cache in the evaluator, and the original 0.23 permissive extraction gate. Later reruns use the final retrieval implementation and should not be presented as byte-identical historical code snapshots.

Backend testing found and fixed: (1) a numeric `changed` field overwrote the reload boolean; (2) added role-override phrasing diluted access classification; (3) failed shared model calls could be billed repeatedly; (4) model-supplied extra fields/calculation units needed output projection and disclosure checks; (5) audit ownership needed an exclusive per-directory guard. Final evidence is in the tests and the recorded validation report. Tests use independent synthetic data and fake providers; no fake provider output is presented as a live model result.

Three Playwright journeys exercised the desktop source/answer flow, role clearing and export, document filtering, timeline comparison, the six-case lab, audit view, mobile overflow and hostile markup. Screenshots are under `results/screenshots/`. Visual inspection confirmed a responsive source-centered interface; it is not an accessibility certification.

The final harness check uncovered two test-environment details: Node Fetch owns the Host header, so the rebinding test was corrected to use raw HTTP; and Playwright's default force-stop can leave an audit ownership file, so browser runs now use separate data directories and graceful SIGTERM. The final 21 backend tests and 3 browser journeys pass. [results/raw/verification-2026-09-07.json](results/raw/verification-2026-09-07.json) summarizes the final observed checks, including a successful request against the running handoff service.

The first process-restart rehearsal was denied permission to bind a localhost port by the tool sandbox. It was rerun with the required permission and passed through real HTTP. A similar sandbox restriction affected one HTTP-test invocation and the initial load invocation; authorized reruns passed. These are environment failures, not discarded model attempts. Docker inspection also confirmed the daemon was not running; no container success is claimed. All these attempts had zero model API spend.

The in-memory lab and then the real-process freshness rehearsal are preserved separately in `results/raw/freshness-*.json`. The latest `results/freshness_rehearsal.json` is the actual service stop/restart check. No public or private held-out labels were used to tune behavior. The initial no-key phase ended before live model or semantic judging.

## Live follow-up after the user configured a key

| Time | Experiment | Observation |
|---|---|---|
| 10:48:43 | First 146-case live run | 19 evidence-verification errors, coverage 0.7647; $0.0730056 generation |
| 10:50:32 | Bounded failed-case diagnosis | Found invalid date/expression operands, unavailable numeric literals and excessive evidence-ID lists |
| 10:52:24 | Constrained schema and receipt instructions | Errors reduce to 15; coverage 0.7983; one OOC fabrication remains |
| 10:53:36 | Second diagnosis | Schema shape is valid but source operands are still unsupported; no private data or gold enters generation |
| 10:56:09 | Optional receipt isolation + official semantic judge | Zero errors; accuracy 0.8151, coverage 0.9160, citation support 0.8882; 276 judge calls, zero judge errors |
| 10:57:07 | Isolated Docker smoke test | Eight checks pass; Linux/ARM64, non-root, read-only, no network or key |
| 10:58:14 | First cold-cache live HTTP load | 146 requests, one verifier rejection, p95 3.216 seconds; raw failure retained |
| 11:00:03 | Single failed-load case replay | Passed; the original failed draft was not available, so no exact root cause is claimed |
| 11:02:31 | Concise answers, per-request evidence-ID schema, strong-match model route | Zero errors; accuracy 0.8824, temporal 0.8947, coverage 0.9664, citation support 0.9181; 292 judge calls, zero errors |
| 11:03:19 | Final-code Docker smoke | Eight checks pass with final serving code |
| 11:06:35 | Final cold-cache live HTTP load | 146 requests, zero errors/cache hits, p95 2.685 seconds |

The raw evaluation, diagnostic and load artifacts preserve earlier failures. No automatic test retries conceal them. At the end of this phase, the suite had 25 backend tests, eight offline browser tests, and two opt-in real-model browser tests. New regressions covered historical source-link dates, pending-answer role changes, outage recovery, export contents, explicit arithmetic warnings, admin-body validation and releasing the audit lease after a failed asset startup. A scan of 93 shareable source/test/result files at that point found no configured secret values.

Sandbox restrictions initially blocked some localhost bindings and live requests. Authorized reruns succeeded after demonstrating that the corpus and development gold were the unchanged public release, not private company/evaluator data. Docker Desktop was started with approval; its temporary QA containers were stopped after testing. No submission was published or sent.

Evaluation accounting corrections: early `seed: 42` entries were metadata only, not a provider sampling seed. New runs record `seed: null`. The 10:56 judge run's `latency.total_ms` includes grading wall time due to a harness timing bug; its individual-request p95 is valid. The 11:02 run fixes this by separating generation duration from `evaluation_wall_ms`. Semantic judge token usage remains unavailable from the unmodified upstream grader.

## Paraphrase follow-up

The user reported refusals after rewording supported questions. Read-only inspection confirmed the API key was loaded and generation was live; insufficient lexical overlap and incomplete packing were the failure paths. No `.env` values were changed. A hand-authored, source-derived regression set was added without reading held-out questions.

| Time (UTC) | Experiment | Observation |
|---|---|---|
| 11:28:46 | First lexical comparison under the restricted sandbox | Provider networking failed; preserved as an environment-failed run, not a baseline quality score |
| 11:29:10 | Authorized live lexical baseline | 29/41 total; 11/20 paraphrases, 10/10 canonical questions, 8/11 boundaries; $0.013176 candidate usage |
| 11:29:35 | Initial semantic fusion + balanced snippets | 38/41; three semantic-only matches still buried by incidental lexical votes; first index cost $0.00079656 |
| 11:31:24 | Downweight weak lexical votes | 40/41; a reporting paragraph still displaced by title/date boilerplate |
| 11:32:53 | Protect semantic candidates | 41/41 focused cases; full-development evaluation required before declaring success |
| 11:33:31 | Always-fused full development + official judge | 0 runtime/judge errors, coverage 0.9748, but accuracy regressed to 0.8403 and temporal to 0.8421; 298 judge calls. This experiment was not retained |
| 11:36:35 | Linux/ARM64 offline smoke | Eight checks passed; this image predates the subsequent adaptive recovery change |
| 11:41:34 | Full evaluation of that adaptive/metadata experiment | Accuracy 0.8571, temporal 0.8421, contradiction 1.0; one OOC entity/metric substitution (NBFC vs credit rating agency), so metadata compression was reverted; 290 judge calls, zero judge errors |
| 11:41:50 | Adaptive lexical-primary/semantic-recovery + deduplicated metadata | 41/41 focused cases; preserves established lexical evidence, with at most one fully metered recovery after abstention; $0.02114330 candidate usage |
| 11:47:56 | Final adaptive recovery with per-excerpt labels + official judge | 117/119 covered, 103/119 correct (0.8655), contradiction 8/8, temporal 18/19, citation support 164/174, OOC 6/6, access refusal 20/21; 297 judge calls, zero runtime/judge errors; $0.08389814 candidate usage |
| 11:48:08 | Adaptive recovery with original per-excerpt source labels restored | 41/41 focused cases; 20/20 paraphrases and 11/11 boundaries; $0.02115450 candidate usage |
| 11:50:58 | Final Linux/ARM64 offline container smoke | Eight checks passed on non-root, read-only, network-disabled image; no API key in container |
| 11:51:39 | Final synthetic freshness and process-restart rehearsal | Six cases and real stop/restart passed; initial sandbox bind failure retained as an environment failure |
| 11:53:57 | Final cold-answer-cache live HTTP load | 146 requests at concurrency 12; zero errors/cache hits, p50 2.032 seconds, p95 3.128 seconds; corpus embedding index already built |

Unit tests caught a window-ranking bug: scoring before trimming a quote could select a window whose matching sentence was then removed. Scoring the actual complete window fixed it. Review also found retry/error accounting needed to include earlier attempts without double-counting a corpus-changing error. Tests cover this change, shared embedding/generation calls, embedding outages, identity/schema mismatches, index corruption/reuse, and a refresh while query embedding is pending.

All preceding raw runs remain in `results/raw/`. No automatic provider/test retry hides failures. Full evaluation and real-browser tests were repeated after adaptive recovery. The live test inputs are verified public release excerpts and authored regression questions; the configured key never enters artifacts, browser code or containers. See [PARAPHRASE_FIX.md](PARAPHRASE_FIX.md) for reproducible commands and limits.

The final suite passes 38 backend tests, nine offline Chromium journeys and three real-model Chromium journeys. The app was restarted in semantic-plus-lexical model mode using the existing key. Full-development performance remains mixed: overall accuracy is below the earlier 88.24% result and the 88% target; mean input usage is 1,139.29 against a 1,005-token target. One blocked question is still answered. The 272 earlier lexical held-out predictions remain historical and unscored; held-out inputs were not revisited for this fix. Provider/judge nondeterminism prevents attributing every score difference to a single code change. Total testing spend remains unknown because the unchanged judge does not expose token usage.
