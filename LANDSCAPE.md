# Alternatives and where this design fits

This is a small-corpus engineering solution, not a claim that lexical retrieval is universally superior. The challenge’s published [reference pipeline](https://github.com/Deployment-inc/Deployment.inc-Hiring-Problems/blob/main/references/OP-05/README.md) uses TF-IDF/top-six retrieval. The more recent [calibration](https://github.com/Deployment-inc/Deployment.inc-Hiring-Problems/blob/main/CALIBRATION.md) demonstrates that plausible retrieval/model plumbing alone does not clear the stricter bars. Both informed the baseline and the explicit failure analysis here.

| Approach | Strength | What it does not solve by itself |
|---|---|---|
| Sparse lexical retrieval | Cheap, inspectable, deterministic, easy to rebuild | Paraphrases, subject ambiguity and semantic answerability |
| Dense embeddings / hybrid vector retrieval | Can find semantically related wording | Authority, access, version validity, entailment, indexing cost disclosure |
| Learned cross-encoder reranking | Can improve ranking of a retrieved candidate set | Missing candidates, fabricated claims, or a wrong-date source |
| Whole-book prompting | Avoids some retrieval misses on very small books | Token budget, unauthorized context exposure, contradictory versions |
| Structured policy/rule engine | Explicit conditions, exact arithmetic and decision paths | Cost of modeling unseen policies and keeping rules synchronized with source text |
| Generic hosted document chat | Fast application integration | The exact published role/date/refusal/citation and metering contract still needs to be demonstrated |

Policy Atlas starts with the shipped passage units, a budget model behind a narrow structured boundary, and deterministic release checks. The document-prior addition is a modest retrieval experiment; the top-six development section recall does not prove the model can answer. If paraphrase failures dominate live evaluation, the next measured experiment is an embedding or reranker addition with role/date filtering before generation and explicit usage accounting. If arithmetic/date-condition failures dominate, the next experiment is a typed calculation/date tool bound to cited spans. If correctness is high but refusal is poor, develop an independent negative set and an answerability/entailment verifier within the same budget class.

The provider envelope uses [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), which constrain output shape but do not guarantee factual correctness. Snapshot/rate choices follow the challenge’s [fixed model pins](https://github.com/Deployment-inc/Deployment.inc-Hiring-Problems/blob/main/MODELS.md). Source content and model outputs are treated as data, not instructions. No unverified claim about a vendor’s present capability or price is needed to operate the offline prototype.
