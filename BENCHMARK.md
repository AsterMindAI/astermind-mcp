# AsterMind MCP — Benchmark & Methodology

Every number in the README comes from this benchmark. It is reproducible:

```bash
npm run benchmark        # writes benchmark/results.json
npm run benchmark:sweep  # top-K policy sweep
```

## What is measured

For each scenario we have a query, 10 retrieved candidate passages, and a hand-labeled set of which
passages are actually relevant (contain information that answers the query). The server reranks the
10 candidates and keeps the **top 3 by rerank score** (the default policy). We then measure:

- **Token saving** — input tokens for all 10 candidates vs. the 3 kept, counted with
  `gpt-tokenizer` (o200k/cl100k BPE, OpenAI-compatible). This is the real number a caller would save
  on prompt input tokens.
- **Answer-present hit rate** — did at least one relevant passage survive filtering? This is the
  quality floor: if this drops, the "saving" is fake because you dropped the answer.
- **All-relevant recall** — of every labeled-relevant passage, how many survived. Strict; multi-hop
  questions with 3 relevant passages can't all fit in a top-3 keep, so this is honestly below 100%.
- **Precision** — of the 3 kept passages, how many were relevant.

## Aggregate result (top-3 default, 6 scenarios)

| Metric | Value |
|---|---|
| Scenarios | 6 |
| Average token saving | 66.9% |
| Overall token saving (by total tokens) | 66.8% |
| Answer-present hit rate | 100% |
| Average all-relevant recall | 55.6% |
| Average precision | 50% |
| Total tokens before → after | 926 → 307 |
| Tokenizer | gpt-tokenizer (o200k/cl100k BPE) |

## Per-scenario

| Scenario | Query | Before → After | Saved | Answer present | Recall |
|---|---|---|---|---|---|
| SaaS support KB | password reset | 170 → 54 | 68.2% | yes | 2/3 |
| API docs | rate limits / 429 | 169 → 61 | 63.9% | yes | 2/3 |
| HR policy | remote work / expense | 143 → 39 | 72.7% | yes | 1/2 |
| E-commerce FAQ | shipping / returns | 149 → 54 | 63.8% | yes | 2/3 |
| DevOps runbook | rollback failed deploy | 148 → 51 | 65.5% | yes | 1/2 |
| Fintech help | dispute fraudulent charge | 147 → 48 | 67.3% | yes | 1/3 |

## Policy sweep (keep top-K of 10)

Savings and recall trade off directly. The answer-present hit rate stayed at 100% at every K because
the rank-1 passage was always relevant.

| Top-K | Token saving | Answer-present | All-relevant recall |
|---|---|---|---|
| 1 | ~87.9% | 100% | 38.9% |
| 3 | 66.8% | 100% | ~55–75% |
| 6 | ~46% | 100% | 75% |

## How to read this honestly

- The **strong, defensible claim** is: rerank locally, keep the top passages, and cut roughly
  **two-thirds of your retrieved-context tokens while a relevant passage survives in 100% of these
  scenarios.**
- The **limitation** is strict all-relevant recall: for questions that genuinely need multiple
  passages, top-3 will miss some. Use a larger K (top-5/6) for multi-hop retrieval and accept a
  smaller — still real — token cut.
- The reranker is **lexical (TF-IDF)**. It relies on shared vocabulary between query and passage.
  These scenarios reflect that common case; a corpus that answers questions only in synonyms will
  see weaker ranking.

## Caveats

- This is a small, hand-built benchmark (6 scenarios, 60 passages) meant to be transparent and
  reproducible, not a claim about every corpus. Run it on your own data with your own labels — the
  harness in `benchmark/` is the same code and takes your scenarios directly.
- Savings are on **retrieved-context input tokens**. Output tokens and non-RAG prompts are
  unaffected.
