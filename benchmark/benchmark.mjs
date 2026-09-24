/**
 * Token-reduction benchmark for the AsterMind MCP server.
 *
 * Honest measurement: for each realistic RAG scenario we (a) count the tokens of
 * the FULL candidate context and the FILTERED context with a real OpenAI-compatible
 * tokenizer, and (b) check RECALL — whether the filter kept the documents that
 * actually contain the answer. Token savings only count as real value if recall
 * stays high, so both are reported.
 */
import { rerankDocuments, countTokens } from '../src/engine.js';
import { scenarios } from './scenarios.js';
import { writeFileSync } from 'node:fs';

const MAX_DOCS = 3; // top-K by rerank rank (honest default; see sweep.mjs)
const MIN_RELEVANCE = 0; // optional noise floor; 0 = rank-only

function runScenario(s) {
  const ranked = rerankDocuments(s.query, s.documents); // sorted best-first, with .index & .relevance
  const kept = ranked.slice(0, MAX_DOCS).filter((r) => r.relevance >= MIN_RELEVANCE);
  const keptIdx = new Set(kept.map((k) => k.index));

  const tokensBefore = s.documents.reduce((sum, d) => sum + countTokens(d), 0);
  const tokensAfter = kept.reduce((sum, k) => sum + countTokens(k.content), 0);
  const savedPct = tokensBefore ? (tokensBefore - tokensAfter) / tokensBefore : 0;

  const relevantKept = s.relevant.filter((i) => keptIdx.has(i)).length;
  const recall = s.relevant.length ? relevantKept / s.relevant.length : 1;
  const precision = kept.length ? relevantKept / kept.length : 0;
  const answerPresent = relevantKept >= 1; // at least one relevant passage kept

  return {
    name: s.name,
    query: s.query,
    totalDocs: s.documents.length,
    keptDocs: kept.length,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore - tokensAfter,
    savedPct: Math.round(savedPct * 1000) / 10,
    relevantTotal: s.relevant.length,
    relevantKept,
    answerPresent,
    recall: Math.round(recall * 1000) / 10, // percent (all relevant)
    precision: Math.round(precision * 1000) / 10,
    keptIndices: [...keptIdx].sort((a, b) => a - b),
  };
}

const results = scenarios.map(runScenario);

const agg = {
  scenarios: results.length,
  avgSavedPct: Math.round((results.reduce((a, r) => a + r.savedPct, 0) / results.length) * 10) / 10,
  answerPresentPct: Math.round((results.filter((r) => r.answerPresent).length / results.length) * 1000) / 10,
  avgRecall: Math.round((results.reduce((a, r) => a + r.recall, 0) / results.length) * 10) / 10,
  avgPrecision: Math.round((results.reduce((a, r) => a + r.precision, 0) / results.length) * 10) / 10,
  totalTokensBefore: results.reduce((a, r) => a + r.tokensBefore, 0),
  totalTokensAfter: results.reduce((a, r) => a + r.tokensAfter, 0),
  policy: { minRelevance: MIN_RELEVANCE, maxDocs: MAX_DOCS, note: 'keep top-3 by rerank rank' },
  tokenizer: 'gpt-tokenizer (o200k/cl100k BPE, OpenAI-compatible)',
  timestamp: new Date().toISOString(),
};
agg.overallSavedPct =
  Math.round(((agg.totalTokensBefore - agg.totalTokensAfter) / agg.totalTokensBefore) * 1000) / 10;

// Console report
console.log('='.repeat(78));
console.log('AsterMind MCP — Token Reduction Benchmark');
console.log('Policy: keep docs with relevance >=', MIN_RELEVANCE, '| max', MAX_DOCS, 'docs |', agg.tokenizer);
console.log('='.repeat(78));
for (const r of results) {
  console.log(`\n${r.name}`);
  console.log(`  query: "${r.query}"`);
  console.log(`  docs kept: ${r.keptDocs}/${r.totalDocs}  |  tokens: ${r.tokensBefore} -> ${r.tokensAfter}  (saved ${r.savedPct}%)`);
  console.log(`  answer present: ${r.answerPresent ? 'YES' : 'NO'}  |  all-relevant recall: ${r.relevantKept}/${r.relevantTotal} = ${r.recall}%  |  precision: ${r.precision}%`);
}
console.log('\n' + '='.repeat(78));
console.log('AGGREGATE');
console.log(`  scenarios:          ${agg.scenarios}`);
console.log(`  avg token saving:   ${agg.avgSavedPct}%   (overall by tokens: ${agg.overallSavedPct}%)`);
console.log(`  answer present:     ${agg.answerPresentPct}%   <-- at least one relevant passage kept`);
console.log(`  avg all-rel recall: ${agg.avgRecall}%   <-- ALL relevant docs retained (multi-hop harder)`);
console.log(`  avg precision:      ${agg.avgPrecision}%`);
console.log(`  total tokens:     ${agg.totalTokensBefore} -> ${agg.totalTokensAfter}`);
console.log('='.repeat(78));

writeFileSync(
  new URL('./results.json', import.meta.url),
  JSON.stringify({ aggregate: agg, scenarios: results }, null, 2),
);
console.log('\nWrote benchmark/results.json');
