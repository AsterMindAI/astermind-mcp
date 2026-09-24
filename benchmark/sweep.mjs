/**
 * Policy sweep: find an operating point that preserves RECALL (keeps the answer)
 * while still cutting tokens. Reports recall + savings for several keep-policies
 * so the recommended default is chosen from evidence, not wishful thinking.
 */
import { rerankDocuments, countTokens } from '../src/engine.js';
import { scenarios } from './scenarios.js';
import { writeFileSync } from 'node:fs';

function evalPolicy(topK) {
  const per = scenarios.map((s) => {
    const ranked = rerankDocuments(s.query, s.documents);
    const kept = ranked.slice(0, topK); // top-K by rerank rank
    const keptIdx = new Set(kept.map((k) => k.index));
    const tokensBefore = s.documents.reduce((a, d) => a + countTokens(d), 0);
    const tokensAfter = kept.reduce((a, k) => a + countTokens(k.content), 0);
    const relevantKept = s.relevant.filter((i) => keptIdx.has(i)).length;
    return {
      savedPct: (tokensBefore - tokensAfter) / tokensBefore,
      recall: relevantKept / s.relevant.length,
      hit: relevantKept >= 1 ? 1 : 0, // at least one relevant passage kept (answer present)
      tokensBefore,
      tokensAfter,
    };
  });
  const avg = (f) => per.reduce((a, x) => a + f(x), 0) / per.length;
  const tb = per.reduce((a, x) => a + x.tokensBefore, 0);
  const ta = per.reduce((a, x) => a + x.tokensAfter, 0);
  return {
    topK,
    avgRecallPct: Math.round(avg((x) => x.recall) * 1000) / 10,
    hitRatePct: Math.round(avg((x) => x.hit) * 1000) / 10,
    avgSavedPct: Math.round(avg((x) => x.savedPct) * 1000) / 10,
    overallSavedPct: Math.round(((tb - ta) / tb) * 1000) / 10,
    scenariosWithFullRecall: per.filter((x) => x.recall === 1).length,
  };
}

const policies = [1, 2, 3, 4, 5, 6].map(evalPolicy);

console.log('Policy sweep — keep top-K reranked docs (of 10 candidates), 6 RAG scenarios');
console.log('topK | hitRate(answer present) | avgRecall(all rel) | overallSaved');
console.log('-----+------------------------+--------------------+-------------');
for (const p of policies) {
  console.log(
    `  ${String(p.topK).padEnd(2)} |          ${String(p.hitRatePct).padStart(5)}%        |       ${String(p.avgRecallPct).padStart(5)}%       |    ${String(p.overallSavedPct).padStart(5)}%`,
  );
}

// Recommend the smallest topK that keeps the answer present (hitRate) in 100% of scenarios.
const rec = policies.find((p) => p.hitRatePct >= 100) || policies[policies.length - 1];
console.log(`\nRecommended default: keep top ${rec.topK}  ->  answer present ${rec.hitRatePct}% of scenarios, token saving ${rec.overallSavedPct}% (strict all-relevant recall ${rec.avgRecallPct}%)`);

writeFileSync(new URL('./sweep.json', import.meta.url), JSON.stringify({ policies, recommended: rec }, null, 2));
console.log('Wrote benchmark/sweep.json');
