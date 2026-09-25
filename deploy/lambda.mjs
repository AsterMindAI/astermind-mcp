/**
 * AsterMind hosted API — AWS Lambda handler (Function URL, payload format v2.0).
 *
 * Exposes the REAL AsterMind engine (./engine.js -> @astermind/astermind-community)
 * over HTTPS. Every route runs on-device ML. NOTHING here is a stub.
 *
 * Routes:
 *   GET  /            -> service info + tool list                       (open)
 *   GET  /health      -> liveness + engine version                      (open)
 *   GET  /demo        -> zero-input live proof of token reduction       (open)
 *   GET  /license     -> the caller's licence status                    (needs a licence header)
 *   POST /v1/<tool>   -> call one of the 10 engine tools with JSON body (needs a licence that includes <tool>)
 *
 * Licence: send `Authorization: Bearer AMCP-LIC.v1.…` (or `x-astermind-license: AMCP-LIC.v1.…`).
 * See ./license.mjs for the token format and checks.
 */
import * as E from './engine.js';
import { makeLicenseChecker, tokenFromHeaders, allowsTool, warningHeader } from './license.mjs';

const VERSION = '0.2.0';
const ENGINE = '@astermind/astermind-community@3.0.0';
const LICENSE_HELP = 'Send your licence as `Authorization: Bearer AMCP-LIC.v1.…`. To get or renew one, contact AsterMind AI (https://astermindai.com).';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-astermind-license',
  'access-control-expose-headers': 'x-astermind-license-warning',
};

const json = (statusCode, obj, extraHeaders = {}) => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
  body: JSON.stringify(obj, null, 2),
});

// What a caller may see about their own licence. Never echoes the token itself.
const licenseView = (lic) => ({
  state: lic.state,
  reason: lic.reason || undefined,
  licenseId: lic.licenseId,
  customer: lic.customer,
  edition: lic.edition || undefined,
  expiresAt: Number.isInteger(lic.expiresAt) ? new Date(lic.expiresAt * 1000).toISOString() : undefined,
  daysRemaining: lic.daysRemaining,
  graceDaysRemaining: lic.graceDaysRemaining,
  tools: lic.tools,
});

// 401 when no licence was sent, 403 when one was sent but cannot be used.
const licenseRefusal = (lic) =>
  json(lic.state === 'MISSING' ? 401 : 403,
    { error: 'LICENSE_' + lic.state, message: lic.reason, help: LICENSE_HELP, ...(lic.state === 'MISSING' ? {} : { license: licenseView(lic) }) },
    lic.state === 'MISSING' ? { 'www-authenticate': 'Bearer realm="AsterMind MCP"' } : {});

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

// The licence checker is injectable so tests can use a throwaway key pair; the Lambda uses the production key.
export function makeHandler({ checkLicense = makeLicenseChecker() } = {}) {
  return async (event) => {
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
            proof: 'GET /demo  — zero-input live token-reduction proof (no licence needed)',
            call: 'POST /v1/<tool> with a JSON body, e.g. /v1/compress_context (licence required)',
            license: 'GET /license — check your licence status. ' + LICENSE_HELP,
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
      if (method === 'GET' && path === '/license') {
        const lic = checkLicense(tokenFromHeaders(event.headers));
        if (lic.state === 'MISSING') return licenseRefusal(lic);
        return json(200, { license: licenseView(lic) });
      }
      if (method === 'POST' && path.startsWith('/v1/')) {
        const name = path.slice('/v1/'.length);
        const fn = TOOLS[name];
        if (!fn) return json(404, { error: `unknown tool '${name}'`, tools: TOOL_NAMES });
        const lic = checkLicense(tokenFromHeaders(event.headers));
        if (!lic.ok) return licenseRefusal(lic);
        if (!allowsTool(lic, name)) {
          return json(403, { error: 'LICENSE_TOOL_NOT_INCLUDED', message: `Your licence does not include ${name}`, help: LICENSE_HELP, license: licenseView(lic) });
        }
        const body = parseBody(event);
        if (body === null) return json(400, { error: 'invalid JSON body' });
        const result = fn(body);
        const warning = warningHeader(lic);
        return json(200, { tool: name, result }, warning ? { 'x-astermind-license-warning': warning } : {});
      }
      return json(404, { error: 'not found', method, path, hint: 'GET / for usage' });
    } catch (err) {
      return json(500, { error: 'engine error', message: String(err?.message || err) });
    }
  };
}

export const handler = makeHandler();
