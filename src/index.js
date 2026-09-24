#!/usr/bin/env node
/**
 * AsterMind MCP Server
 * On-device ML tools that cut LLM token usage — reranking, context filtering,
 * classification, language detection — backed by @astermind/astermind-community.
 * Nothing leaves the machine. Every tool calls the real engine (see engine.js).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as E from './engine.js';

const server = new McpServer({
  name: 'astermind-mcp',
  version: '0.1.0',
});

const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// 1. rerank_documents
server.registerTool(
  'rerank_documents',
  {
    title: 'Rerank documents by relevance',
    description:
      'Rank candidate documents/chunks by relevance to a query using an on-device ELM reranker. Best when the query shares vocabulary with the documents (typical RAG). Lexical (TF-IDF) based: strong on keyword overlap, weaker on pure-synonym matches.',
    inputSchema: {
      query: z.string().describe('The user query or question.'),
      documents: z.array(z.string()).describe('Candidate documents/chunks to rank.'),
      topK: z.number().int().positive().optional().describe('Return only the top K (default: all).'),
    },
  },
  async ({ query, documents, topK }) => ok(E.rerankDocuments(query, documents, { topK: topK ?? documents.length })),
);

// 2. filter_context
server.registerTool(
  'filter_context',
  {
    title: 'Filter context to relevant docs (token saver)',
    description:
      'Drop documents not relevant to the query so you feed the LLM a small, relevant context instead of everything. Reports exact tokens saved using an OpenAI-compatible tokenizer. This is the core token-reduction tool.',
    inputSchema: {
      query: z.string(),
      documents: z.array(z.string()),
      maxDocs: z.number().int().positive().optional().describe('Max docs to keep (default 5).'),
      minRelevance: z.number().min(0).max(1).optional().describe('Min relevance 0..1 to keep a doc (default 0.5).'),
    },
  },
  async ({ query, documents, maxDocs, minRelevance }) =>
    ok(E.filterContext(query, documents, { maxDocs: maxDocs ?? 3, minRelevance: minRelevance ?? 0 })),
);

// 3. compress_context
server.registerTool(
  'compress_context',
  {
    title: 'Compress context into a ready-to-paste block',
    description:
      'One-shot token saver: filter candidate documents to what is relevant and return a compact, numbered context block ready to paste into a prompt, plus token-before/after accounting.',
    inputSchema: {
      query: z.string(),
      documents: z.array(z.string()),
      maxDocs: z.number().int().positive().optional(),
      minRelevance: z.number().min(0).max(1).optional(),
    },
  },
  async ({ query, documents, maxDocs, minRelevance }) =>
    ok(E.compressContext(query, documents, { maxDocs: maxDocs ?? 3, minRelevance: minRelevance ?? 0 })),
);

// 4. classify_text
server.registerTool(
  'classify_text',
  {
    title: 'Classify text (train-from-examples)',
    description:
      'Classify text into your categories using an on-device ELM trained on the labeled examples you provide. Requires at least one example per category. Returns a confidence and honestly flags low-confidence results. Use this to route/label locally instead of paying an LLM to classify.',
    inputSchema: {
      text: z.string().describe('Text to classify.'),
      categories: z.array(z.string()).describe('The category labels.'),
      examples: z
        .array(z.object({ text: z.string(), label: z.string() }))
        .describe('Labeled training examples (>= 1 per category).'),
    },
  },
  async ({ text, categories, examples }) => ok(E.classifyText(text, categories, examples)),
);

// 5. detect_language
server.registerTool(
  'detect_language',
  {
    title: 'Detect language',
    description:
      'Coarse language detection over 6 European languages (English, Spanish, French, German, Italian, Portuguese) using an on-device classifier. Runs locally with no API call.',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ok(E.detectLanguage(text)),
);

// 6. semantic_search
server.registerTool(
  'semantic_search',
  {
    title: 'Search a document set',
    description:
      'Return the top documents matching a query from a provided set, scored by an on-device lexical (TF-IDF) reranker. Strong on keyword overlap; not a transformer embedding search.',
    inputSchema: {
      query: z.string(),
      documents: z.array(z.string()),
      topK: z.number().int().positive().optional(),
    },
  },
  async ({ query, documents, topK }) => ok(E.semanticSearch(query, documents, { topK: topK ?? 5 })),
);

// 7. generate_embeddings
server.registerTool(
  'generate_embeddings',
  {
    title: 'Generate on-device embeddings',
    description:
      'Produce deterministic local char-level embeddings for a list of texts. Good for clustering, dedupe, and near-duplicate detection. Not a substitute for large transformer embeddings on nuanced semantics.',
    inputSchema: { texts: z.array(z.string()) },
  },
  async ({ texts }) => ok(E.generateEmbeddings(texts)),
);

// 8. compare_texts
server.registerTool(
  'compare_texts',
  {
    title: 'Compare two texts (near-duplicate similarity)',
    description:
      'Cosine similarity (0..1) between two texts using local embeddings. Best for detecting near-duplicates / paraphrase overlap, not fine-grained semantic ranking.',
    inputSchema: { text1: z.string(), text2: z.string() },
  },
  async ({ text1, text2 }) => ok(E.compareTexts(text1, text2)),
);

// 9. count_tokens
server.registerTool(
  'count_tokens',
  {
    title: 'Count tokens',
    description:
      'Count tokens in a string or array of strings using an OpenAI-compatible BPE tokenizer (o200k/cl100k family). Useful for measuring context size and budgeting.',
    inputSchema: { text: z.union([z.string(), z.array(z.string())]) },
  },
  async ({ text }) => {
    const items = Array.isArray(text) ? text : [text];
    const perItem = items.map((t) => E.countTokens(t));
    return ok({ totalTokens: perItem.reduce((a, b) => a + b, 0), perItem });
  },
);

// 10. estimate_savings
server.registerTool(
  'estimate_savings',
  {
    title: 'Estimate token & cost savings',
    description:
      'Given the full context vs the filtered context you plan to send an LLM, compute tokens removed, percent saved, and (optionally) dollars saved per call for a given model input price.',
    inputSchema: {
      fullContext: z.union([z.string(), z.array(z.string())]),
      filteredContext: z.union([z.string(), z.array(z.string())]),
      usdPerMillionInputTokens: z.number().min(0).optional(),
    },
  },
  async ({ fullContext, filteredContext, usdPerMillionInputTokens }) =>
    ok(E.estimateSavings(fullContext, filteredContext, usdPerMillionInputTokens ?? 0)),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it never corrupts the stdio JSON-RPC stream.
  console.error('AsterMind MCP server running (stdio). 10 tools ready.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
