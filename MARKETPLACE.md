# AsterMind MCP — Marketplace Listing Copy

Ready-to-paste copy for each directory. **Every number here is measured** (see BENCHMARK.md).
Do not add unmeasured claims to any of these.

---

## One-liner (Smithery / Glama / mcp.so / PulseMCP short field)

> On-device reranking and context filtering that cuts RAG prompt tokens ~67% while keeping a relevant passage in 100% of benchmark scenarios. No API keys, no data leaves the machine.

## Tagline (≤60 chars)

> Cut RAG tokens ~67% on-device. Nothing leaves the box.

## Short description (2–3 sentences, directory body)

> AsterMind MCP reranks your retrieved context locally and sends the model only the passages that answer the question. On a 6-scenario RAG benchmark it cut context tokens by 66.8% (926→307) while a relevant passage survived filtering in 100% of scenarios. Runs on Node 18+ with no GPU, no configuration, and no network calls — built on the MIT-licensed AsterMind Community ELM engine.

## Category tags

`rag` · `token-reduction` · `reranking` · `context` · `on-device` · `privacy` · `retrieval` · `classification`

---

## Awesome MCP Servers — PR line

Add under the Search / RAG section of the README:

```markdown
- [AsterMind MCP](https://github.com/AsterMindAI/astermind-mcp) 📇 🏠 - On-device reranking & context filtering that cuts RAG prompt tokens ~67% (measured) while keeping a relevant passage in 100% of benchmark scenarios. No network calls.
```

(Legend: 📇 = JavaScript/TypeScript, 🏠 = local service.)

---

## Longer listing (for a product page / Glama detail)

**AsterMind MCP — send the model less, keep the answer.**

Most RAG pipelines retrieve 8–12 chunks and stuff them all into the prompt. Most of those chunks
don't answer the question — you pay for them anyway, on every call. AsterMind MCP reranks the
retrieved candidates on your own machine and passes forward only the top few.

Measured on a 6-scenario benchmark (support KB, API docs, HR policy, e-commerce FAQ, DevOps
runbook, fintech help), keeping the top 3 of 10 candidates:

- **66.8% fewer context tokens** (926 → 307)
- **100% answer-present** — a passage that answers the query survived filtering in every scenario
- Tunable: keep top-1 for ~88% savings on single-fact lookups, top-5/6 for multi-hop questions

It is honest about its edges: the reranker is lexical (TF-IDF), so it thrives when the query and the
answer share vocabulary and is weaker on pure-synonym gaps; classification is a low-confidence hint,
not a decision-maker. Full methodology, per-scenario numbers, and a reproducible benchmark ship in
the repo.

10 tools, stdio transport, `npx @astermind/astermind-mcp`. MIT licensed. Nothing leaves the machine.

---

## Claims policy (internal — read before editing any copy)

- Only these numbers are approved for advertising: **66.8% overall / 66.9% avg context-token
  saving**, **100% answer-present hit rate**, **55.6% avg all-relevant recall**, **926→307 tokens**,
  and the top-K sweep figures in BENCHMARK.md.
- Never revive the old unmeasured "30–50% token savings" line.
- A token saving only counts when a relevant passage is preserved. Always pair a savings number with
  the answer-present / recall context.
- Disclose the TF-IDF/synonym limitation and weak classification wherever space allows.
