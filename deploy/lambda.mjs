/**
 * AsterMind hosted API — AWS Lambda handler (Function URL, payload format v2.0).
 *
 * Exposes the REAL AsterMind engine (./engine.js -> @astermind/astermind-community)
 * over HTTPS. Every route runs on-device ML. NOTHING here is a stub.
 *
 * Routes:
 *   GET  /            -> service info + tool list
 *   GET  /health      -> liveness + engine version
 *   GET  /demo        -> zero-input live proof of token reduction (compress_context)
 *   POST /v1/<tool>   -> call one of the 10 engine tools with a JSON body
 */
import * as E from './engine.js';

const VERSION = '0.1.0';
const ENGINE = '@astermind/astermind-community@3.0.0';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...CORS },
  body: JSON.stringify(obj, null, 2),
});

// tool name -> engine call. Named params come straight from the JSON body.
const TOOLS = {
  rerank_documents: (b) =>
    E.rerankDocuments(b.query, b.documents, { topK: b.topK ?? (b.documents?.length ?? 0) }),
  filter_context: (b) =>
    E.filterContext(b.query, b.documents, { maxDocs: b.maxDocs ?? 3, minRelevance: b.minRelevance ?? 0 }),
  compress_context: (b) =>
    E.compressContext(b.query, b.documents, { maxDocs: b.maxDocs ?? 3, minRelevance: b.minRelevance ?? 0 }),
  classify_text: (b) => E.classifyText(b.text, b.categories, b.examples),
  detect_language: (b) => E.detectLanguage(b.text),
  semantic_search: (b) => E.semanticSearch(b.query, b.documents, { topK: b.topK ?? 5 }),
  generate_embeddings: (b) => E.generateEmbeddings(b.texts),
  compare_texts: (b) => E.compareTexts(b.text1, b.text2),
  count_tokens: (b) => {
    const items = Array.isArray(b.text) ? b.text : [b.text];
    const perItem = items.map((t) => E.countTokens(t));
    return { totalTokens: perItem.reduce((a, c) => a + c, 0), perItem };
  },
  estimate_savings: (b) =>
    E.estimateSavings(b.fullContext, b.filteredContext, b.usdPerMillionInputTokens ?? 0),
};
const TOOL_NAMES = Object.keys(TOOLS);

// A small support-KB corpus: only 3 of 10 docs answer the demo query, so the
// filter genuinely removes ~70% of the context. Real output, computed live.
const DEMO_DOCS = [
  "To reset your password, click 'Forgot password' on the sign-in page and follow the emailed link. The link expires after 30 minutes.",
  'Our billing cycle runs monthly on the date you first subscribed. Invoices are emailed to the account owner each period.',
  "If you didn't receive the password reset email, check your spam folder and confirm the address on file is correct in Account Settings.",
  'The mobile app supports iOS 15 and later and Android 11 and later. Download it from the App Store or Google Play.',
  "Passwords must be at least 12 characters and include a number and a symbol; you set a new password at the end of the reset flow.",
  'To export your data, open Settings then Data and choose CSV or JSON. Large exports are emailed as a download link.',
  'Our support team is available Monday to Friday, 9am to 6pm Eastern, via chat and email.',
  'Team plans let you invite up to 25 members and manage roles from the Admin console.',
  'Refunds are available within 14 days of purchase for annual plans; contact billing to request one.',
  'You can change the interface theme between light and dark mode under Settings then Appearance.',
];
const DEMO_QUERY = 'How do I reset my password?';

function demo() {
  const r = E.compressContext(DEMO_QUERY, DEMO_DOCS, { maxDocs: 3 });
  return {
    what:
      'Live, on-device proof: AsterMind filtered a 10-document context down to the few docs ' +
      'actually relevant to the query, then reports exact tokens saved (real BPE tokenizer).',
    query: DEMO_QUERY,
    totalDocs: r.totalDocs,
    keptDocs: r.keptDocs,
    tokensBefore: r.tokensBefore,
    tokensAfter: r.tokensAfter,
    tokensSaved: r.tokensSaved,
    percentSaved: r.percentSaved,
    keptContext: r.context,
    note: 'Numbers are computed by the real engine on this request, not hard-coded.',
  };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  let path = event?.rawPath || event?.path || '/';
  path = path.replace(/\/+$/, '') || '/';

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    if (method === 'GET' && path === '/') {
      return json(200, {
        name: 'AsterMind Hosted API',
        version: VERSION,
        engine: ENGINE,
        description:
          'On-device token-reduction and retrieval tools over HTTPS. Nothing leaves the box beyond ' +
          'what you send this endpoint, and no tool is stubbed.',
        tools: TOOL_NAMES,
        usage: {
          proof: 'GET /demo  — zero-input live token-reduction proof',
          call: 'POST /v1/<tool> with a JSON body, e.g. /v1/compress_context',
          health: 'GET /health',
        },
        source: 'https://github.com/AsterMindAI/astermind-mcp',
      });
    }
    if (method === 'GET' && path === '/health') {
      return json(200, { status: 'ok', version: VERSION, engine: ENGINE, tools: TOOL_NAMES.length });
    }
    if (method === 'GET' && path === '/demo') {
      return json(200, demo());
    }
    if (method === 'POST' && path.startsWith('/v1/')) {
      const name = path.slice('/v1/'.length);
      const fn = TOOLS[name];
      if (!fn) return json(404, { error: `unknown tool '${name}'`, tools: TOOL_NAMES });
      const body = parseBody(event);
      if (body === null) return json(400, { error: 'invalid JSON body' });
      const result = fn(body);
      return json(200, { tool: name, result });
    }
    return json(404, { error: 'not found', method, path, hint: 'GET / for usage' });
  } catch (err) {
    return json(500, { error: 'engine error', message: String(err?.message || err) });
  }
};
