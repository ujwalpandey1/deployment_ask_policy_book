# Operating Policy Atlas

## Startup and readiness

Use Node 22.14+, set `CORPUS_DIR` and `DATA_DIR`, and run `bash scripts/reproduce.sh serve`. `/healthz` returns 200 only after the index and audit chain initialize. In non-loopback deployments configure `AUTH_MODE=runner` or `tokens` first. A missing or corrupt corpus is a startup error. Protect the data directory: it contains sensitive metadata and answer/question hashes, even though plaintext questions are not logged.

With a model key, semantic search defaults on. The configured provider receives corpus text during indexing and each question during query embedding. It must be approved for that data and support `text-embedding-3-small` through `/embeddings`. First startup builds a disk cache under `DATA_DIR/semantic` (`SEMANTIC_CACHE_DIR` overrides it); unchanged restarts make no corpus-embedding calls. `/api/meta.retrieval` reports `semantic+lexical` or `lexical`. `SEMANTIC_SEARCH=off` intentionally opts into the older keyword-only path; no extra API key or admin token is required locally.

## Update procedure

1. Stage a complete proposed corpus with source/version/role metadata and recalculated source hashes.
2. Have the policy owner verify which documents/sections changed, which were superseded or withdrawn, and the effective dates. “Newer” is not enough to infer authority.
3. Run startup validation, regression questions on both sides of each boundary date, access checks at all three roles, and semantic review of changed answers against the staged corpus.
4. Stop/replace/start using the same `CORPUS_DIR`, or replace the configured directory and call authenticated `/api/admin/reload` with `{}`. Only the configured path is accepted; the API cannot fetch arbitrary files or URLs.
5. Verify the returned fingerprint, health, representative changed answers and their audit receipts. Record the release and its policy-owner approval externally.

If live reload fails, the previous complete snapshot remains active. This does not mean the update is safe to ignore: if the old source has legally expired, stop answering until the corrected update is approved. Do not silently serve the old version as a successful refresh. Repeated updates during an answer return a retryable error.

## Errors and ownership

| Symptom | Response |
|---|---|
| `provider_unavailable` / `provider_incomplete` | Check provider access and configured snapshot; preserve failed usage. Do not rewrite it as a policy refusal. |
| `semantic_unavailable` / `semantic_invalid` | Check embedding access, `/embeddings` support and the returned model/vector schema. Preserve unknown spend; this is not evidence that a policy is missing. |
| `semantic_cache_invalid` / `semantic_cache_write_failed` | Preserve the affected cache file for diagnosis. Check data-directory permissions. After stopping the service, move only the identified invalid cache file aside and restart to rebuild it; do not delete the audit log or corpus. |
| `model_identity_mismatch` | Stop model answers until the exact returned model is approved and pricing is pinned. |
| `evidence_verification_failed` | Inspect permitted evidence and model plan in an isolated development run; do not bypass checks. |
| Arithmetic review warning | An unsupported optional receipt was withheld. Independently review the numeric/date interpretation; it is not certified by source-quote checks. |
| Corpus checksum/section failure | Correct staged source metadata or parser output; keep original bytes for investigation. |
| `corpus_changing` | Retry after the release finishes; compare both dates against one snapshot. |
| `audit.lock` exists | Check the PID recorded in that exact directory. Verify the old service is stopped. Preserve the log, then remove only that ownership file and restart. Never run two writers in one directory. |
| Audit hash mismatch/partial line | Quarantine and preserve the original file; restore an independently anchored copy and investigate. Do not truncate away evidence to make startup pass. |

The runtime is single-process. A graceful SIGTERM drains requests and closes the audit file; force-killing can leave the ownership file behind. Do not share its data volume across replicas. Size and rotate/retain audit data under an approved operational policy; built-in automatic rotation and external anchoring are not implemented.

## Credentials and browser behavior

Credentials are environment values. No provider key is sent to the browser. Browser bearer credentials are tab-memory only. Token mode binds the requester role at the server; caller text cannot elevate it. Role changes clear question history, previous answers and the source inspector. Demo role selection is for trusted local evaluation, not identity authentication.

In an answer trace, total API calls include query embeddings and generation. “Search usage” breaks out embeddings. Cache replays have zero new calls. Refusal reason `no_relevant_evidence` means retrieval stopped before generation; `evidence_insufficient` means the model abstained after inspecting excerpts. Export the result with its question, role and date to diagnose a false refusal. Do not lower permission or citation checks to make a question answerable.

## Rehearsal and restore

`npm run rehearse` owns a separate temporary corpus and its own processes on port 4604 (`REHEARSAL_PORT` overrides this). It changes fictional rules, stops/restarts, checks health and answers, and preserves an artifact. It does not modify the real corpus or the running app on 4600. Test data under the printed temporary directory can be retained for investigation.

Back up immutable corpus releases, model/config pins and externally anchored audit receipts. Before restoring a corpus, confirm its effective authority with the policy owner. Restore runtime ownership only after ensuring no previous writer is alive. Verify the same access/date regression suite after restoration.
