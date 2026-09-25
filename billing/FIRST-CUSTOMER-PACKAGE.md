# AsterMind MCP — First-Customer Package

Everything needed to land customer #1. All numbers here are the measured, approved figures
(66.8% fewer context tokens, 926→307; 100% answer-present across a 6-scenario benchmark; live
`/demo` shows 64.5% saved on a real request). Nothing unmeasured. The TF-IDF/synonym limitation is
disclosed wherever the copy has room, per the claims policy in `MARKETPLACE.md`.

Live proof anyone can hit right now, no licence needed: https://mcp.astermind.ai/demo

---

## Target #1 (recommended): AsterMind dogfoods its own product

**Recommendation: make AsterMind AI customer #1 by putting a real $19/mo Pro subscription on the
books and pointing StarNet's own RAG/context steps at `mcp.astermind.ai`.**

Why this is the right first sale, not a cop-out:
- **Fastest close.** No cold outreach, no trust gap. The decision-makers are Julian, Tim G, Coen, Tim B.
- **It exercises the whole revenue chain for real** — a live Stripe charge, the mint-worker issuing a
  real licence, the licence unlocking prod. That is the exact path an external customer walks, proven
  with our own money before we ask anyone else for theirs.
- **It pays for itself in the story.** Julian's original goal was to cut StarNet's token spend. Every
  context step routed through `compress_context`/`filter_context` sends the model fewer tokens. On the
  benchmark shape that is ~67% fewer context tokens per RAG call. At any real StarNet call volume the
  $19/mo is recovered quickly, and now we have a **paying reference customer with a usage story** — the
  single most valuable asset for closing customer #2.
- **Honest caveat to hold onto:** the reranker is lexical (TF-IDF). It shines when the query and the
  answer share vocabulary and is weaker on pure-synonym gaps. Point it at the retrieval-heavy steps
  first, measure, expand from there.

**The ask to the partners (one line):** "Let's be our own first customer — activate the Buy link,
I'll subscribe AsterMind at $19/mo, and we route StarNet's context filtering through it. Real revenue,
real usage data, real reference story, this week."

---

## Backup targets (external, in priority order)

1. **MCP/agent framework builders** shipping RAG (LangChain/LlamaIndex plugin authors, small agent
   startups) — they feel token cost per call and can install in one command.
2. **Solo devs running local agents** (r/LocalLLaMA crowd) who care that nothing leaves the machine.
3. **RAG-heavy SaaS teams** with support-KB or docs assistants — the benchmark scenarios are literally
   their use case.
4. **Smithery browsers** who find us organically now that the listing is live
   (https://smithery.ai/servers/julian-fi9r/astermind-mcp).
5. **StarNet-adjacent agent operators** — anyone else building on this harness with the same token bill.

---

## Ready-to-send external outreach (email)

> **Subject: cut your RAG prompt tokens ~67% — 30-second live proof, no signup**
>
> Hi {name},
>
> Quick one. If you run RAG through an LLM, you're paying for retrieved chunks that don't answer the
> question — on every call. AsterMind MCP reranks the retrieved context on your own machine and passes
> the model only the passages that matter.
>
> Here's a live, zero-signup proof computed on a real request: https://mcp.astermind.ai/demo
> — it filters a 10-doc context to 3 and reports the exact tokens saved (64.5% on that one).
>
> On our 6-scenario RAG benchmark it cut context tokens 66.8% (926→307) while a passage that answers
> the query survived filtering in 100% of scenarios. It's the MIT AsterMind engine; nothing leaves the
> box. Straight about its edge: the reranker is lexical, so it's strongest when query and answer share
> vocabulary.
>
> Install is one command (`npx @astermind/astermind-mcp`), or use the hosted API at $19/mo if you'd
> rather not run it yourself. Happy to send you a licence to try the hosted tier for a week — want one?
>
> — Julian, AsterMind AI · astermindai.com

## DM variant (short)

> Built a thing that might save you money: AsterMind MCP reranks RAG context on-device and sends the
> model ~67% fewer tokens (measured, 926→307), keeping a relevant passage 100% of the time on our
> benchmark. Live proof, no signup: mcp.astermind.ai/demo. Lexical reranker so it's best when query and
> answer share words. `npx @astermind/astermind-mcp` to run it, or $19/mo hosted. Want a trial licence?

---

## Launch post (r/mcp or r/LocalLLaMA)

> **AsterMind MCP — send the model less, keep the answer (on-device RAG token reducer)**
>
> Most RAG pipelines retrieve 8–12 chunks and stuff them all into the prompt; most don't answer the
> question and you pay for them every call. AsterMind MCP reranks the retrieved candidates on your own
> machine and forwards only the top few.
>
> Measured on a 6-scenario benchmark (support KB, API docs, HR policy, e-commerce FAQ, DevOps runbook,
> fintech help), keeping top-3 of 10:
> - 66.8% fewer context tokens (926 → 307)
> - 100% answer-present — a passage answering the query survived filtering in every scenario
> - tunable: top-1 for ~88% savings on single-fact lookups, top-5/6 for multi-hop
>
> Honest about its edges: the reranker is lexical (TF-IDF), so it thrives when the query and answer
> share vocabulary and is weaker on pure-synonym gaps; the classifier is a hint, not a decision-maker.
> Full methodology and a reproducible benchmark are in the repo.
>
> 10 tools, stdio, MIT engine, nothing leaves the machine.
> `npx @astermind/astermind-mcp` · live demo: https://mcp.astermind.ai/demo
> · Smithery: https://smithery.ai/servers/julian-fi9r/astermind-mcp

## X / LinkedIn variant

> We were paying for RAG chunks that never answered the question. So we built AsterMind MCP: it reranks
> retrieved context on-device and sends the model ~67% fewer tokens (measured: 926→307), keeping a
> relevant passage 100% of the time on our 6-scenario benchmark. On-device, MIT engine, nothing leaves
> the box. Lexical reranker, so it's strongest when query and answer share vocabulary. Live proof, no
> signup 👉 mcp.astermind.ai/demo
