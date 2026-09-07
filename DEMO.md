# A five-minute walkthrough

Start with `npm start`, then open http://127.0.0.1:4600. With `LLM_API_KEY` configured in the ignored `.env`, the sidebar should say **Model-assisted answers**. Without a key, the app identifies itself as a conservative source-extract preview.

All examples below use the assignment's published, synthetic policy book—not live customer data or current legal advice.

1. **Ask a practical question.** Keep the Operations role and select “What are the limits for fee waivers?” Read the limit and conditions. Open an evidence badge to inspect the exact source section, effective date and source fingerprint. The model selects IDs; the server creates and verifies the quotes.
2. **Inspect the receipt.** Expand “How this answer was checked” to see the checks, pinned model, actual token usage, per-request cost and chained audit receipt. Ask the same question again: the response is cached, but receives a new request ID and audit receipt with no new generation charge. Export saves the answer and evidence as JSON.
3. **Exercise the permission boundary.** Switch to Public. The previous answer and recent-question history clear. Ask the fee-waiver question again: access is required and no restricted quote is shown. The source library also changes from 28 accessible documents to 25; this is enforced by the server, not just hidden in the UI.
4. **Show the time boundary.** In Policy timeline, compare the fee-waiver question on 1 December 2025 and 7 September 2026. The internal document is effective from 1 January 2026. Inspect the sources at the compared date: source links preserve that date and the cited section.
5. **Run a controlled update.** In Assurance lab, run the six-case rehearsal. It demonstrates supersession, historical answers, amendment, withdrawal, role changes and missing evidence using a separate fictional corpus. It does not modify the assignment corpus or claim a private-pack score.
6. **Close with evidence, not a promise.** Open Audit trail, then show [QA.md](QA.md), [EVALUATION.md](EVALUATION.md), and the browser reports. Distinguish observed engineering tests from qualification and independent compliance review.

## Engineering points worth discussing

Try the same payment topic in different words as Operations: “How many days ahead may a new one-off payment be scheduled at Harbour?”, “At Harbour, how far into the future can I book a fresh repayment?”, and “Could Harbour set up a new debit three months from now, or is that too far away?”. Each should cite the payment section and explain the 60-day ceiling. The trace separates semantic-search usage from generation, while repeats add no API calls. The live regression suite covers these exact browser journeys; see [PARAPHRASE_FIX.md](PARAPHRASE_FIX.md).

- Roles, source bytes, effective dates and relationships are bound into an atomic corpus snapshot; pending answers are rechecked after updates.
- Concurrent identical requests share query embedding and generation without duplicating their billed usage.
- Source citations and permissions fail closed. Optional arithmetic receipts have a separate boundary: unsupported receipts are withheld with a visible review warning, never marked verified.
- The container runs non-root; the QA smoke test additionally uses a read-only filesystem, no network, no API key, one CPU and 256 MB memory.
- The upstream corpus and grader remain byte-for-byte unchanged, and failed experiments are retained.

To reproduce the browser checks: `npm run test:e2e` is offline; `npm run test:e2e:live` explicitly opts into paid real-provider requests. Reports are generated in `results/browser-report/` and `results/live-browser-report/`.

The strongest demonstration includes the limitations: related-but-wrong evidence, ambiguous access classification, temporal interpretation, small negative-set size, and the difference between exact quotation and semantic correctness.
