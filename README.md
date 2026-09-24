# AsterMind MCP

**Cut the tokens you send to an LLM — on your own machine, before the call goes out.**

AsterMind MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that ranks and
filters your retrieved context locally, so you send the model the few passages that actually answer
the question instead of everything your retriever returned. It runs on the
[AsterMind Community Edition](https://www.npmjs.com/package/@astermind/astermind-community) ELM engine.
No network calls, no API keys, no data leaves the machine.

---

## What it actually does (measured, not promised)

On a 6-scenario RAG benchmark (support KB, API docs, HR policy, e-commerce FAQ, DevOps runbook,
fintech help), filtering 10 retrieved candidates down to the **top 3 by rerank score**:

| Metric | Result |
|---|---|
| Average context-token saving | **66.9%** (66.8% overall by tokens) |
| Answer-present hit rate | **100%** (a passage that answers the query survived filtering in every scenario) |
| Total tokens | **926 → 307** |
| Strict "all relevant passages kept" recall | **55.6%** |
| Precision | 50% |

Tokens counted with [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer)
(o200k/cl100k BPE, OpenAI-compatible). Reproduce it yourself: `npm run benchmark`.
Full methodology and per-scenario results are in [BENCHMARK.md](./BENCHMARK.md).

### The honest tradeoff

Savings and recall move in opposite directions — keep fewer chunks, save more tokens, risk dropping
a relevant one. You choose the point on the curve:

| Keep top-K of 10 | Token saving | Answer-present hit rate | All-relevant recall |
|---|---|---|---|
| 1 | ~87.9% | 100% | 38.9% |
| 3 (default) | 66.8% | 100% | ~55–75% |
| 6 | ~46% | 100% | 75% |

**Rank-1 surfaced a relevant passage in 100% of scenarios at every K we tested.** That is the
strong, defensible result. For single-hop questions (FAQ, support, one-fact lookups) keep top 1–3
and cut ~67–88% of context. For multi-hop questions that need several passages, keep top 5–6 —
don't over-filter, or you'll drop a needed passage.

---

## Install

```bash
npx @astermind/astermind-mcp
```

Or add it to your MCP client config (Claude Desktop, Cursor, VS Code, Cline):

```json
{
  "mcpServers": {
    "astermind": {
      "command": "npx",
      "args": ["-y", "@astermind/astermind-mcp"]
    }
  }
}
```

Runs on Node 18+. No GPU, no build step, no configuration.

---

## Tools (10)

| Tool | What it does | Strength |
|---|---|---|
| `rerank_documents` | Score & order candidates against a query | **Strong** — the core value |
| `filter_context` | Keep the top-K / above-threshold passages | **Strong** |
| `compress_context` | Rerank + trim a context block to a token budget | **Strong** |
| `count_tokens` | Exact BPE token count for any text | Exact |
| `estimate_savings` | Before/after token delta for a filtering choice | Exact |
| `semantic_search` | Rank a corpus against a query | Good (lexical) |
| `detect_language` | Identify text language | Good, confidence-flagged |
| `classify_text` | Label text into supplied categories | **Weak** — low-confidence flagged |
| `generate_embeddings` | Character-level vector for text | Near-duplicate use only |
| `compare_texts` | Similarity between two texts | Near-duplicate use only |

Every tool returns a confidence signal. Where the engine is weak, the tool says so rather than
guessing silently.

### Known limitations (stated on purpose)

- **The reranker is lexical (TF-IDF).** It matches on shared terms, so pure synonym gaps can be
  missed — a query for "payment methods" won't strongly rank a passage that only says
  "Visa/Mastercard." It excels when the query and the answer share vocabulary, which is the common
  RAG case.
- **Classification is weak** out of the box and only fair after training — use it as a low-confidence
  hint, not a decision-maker. It flags low confidence.
- **Embeddings are character-level**, useful for near-duplicate detection, not deep semantic
  similarity.

The token savings above are real **only because a relevant passage is preserved.** Cutting tokens by
dropping the answer is not a saving, and this benchmark measures both.

---

## When this saves you money

The server does not shrink an LLM's vocabulary or compress prompts magically. It saves tokens one
specific way: **you retrieve broadly, then send the model only the passages that matter.** If your
RAG pipeline currently stuffs 8–12 retrieved chunks into every prompt, reranking locally and sending
3 is a direct, repeatable cut to your per-call input tokens — and it runs on your machine for free.

---

## Develop & verify

```bash
npm install
npm test              # engine + MCP client round-trip tests
npm run benchmark     # regenerates benchmark/results.json
npm run benchmark:sweep   # top-K policy sweep
```

## License

MIT © AsterMind AI. Built on `@astermind/astermind-community`.
