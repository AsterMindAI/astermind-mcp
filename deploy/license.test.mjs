// Tests for the hosted-API licence (deploy/license.mjs) and its gate in deploy/lambda.mjs.
// Uses a THROWAWAY key pair; the production private key is never needed here.
//   node deploy/license.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeLicenseChecker, tokenFromHeaders, allowsTool, warningHeader, PUBLIC_KEYS, PREFIX } from './license.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 86400;
const NOW = 1_800_000_000; // fixed clock
const test = makeKey(), other = makeKey();
function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, pem: publicKey.export({ type: 'spki', format: 'pem' }) };
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function mint(payload, key = test.privateKey, prefix = PREFIX) {
  const body = b64u(JSON.stringify(payload));
  return prefix + body + '.' + b64u(sign(null, Buffer.from(body), key));
}
const TOOLS = ['compress_context', 'count_tokens'];
const base = (over = {}) => ({ ver: 1, prod: 'astermind-mcp', lid: 'amcp_test_0001', cust: 'Test Co', iat: NOW - DAY, nbf: NOW - DAY,
  exp: NOW + 60 * DAY, grace: 7, edition: 'standard', ent: { tools: TOOLS }, ...over });
const check = makeLicenseChecker({ publicKeys: [{ kid: 'test', pem: test.pem }], now: () => NOW, revoked: () => new Set(['amcp_revoked']) });

let passed = 0;
const t = (name, fn) => { fn(); passed++; };

// --- the checker ---------------------------------------------------------------------------------------------
t('no token is MISSING', () => assert.equal(check('').state, 'MISSING'));
t('a good token is VALID and lists its tools', () => {
  const r = check(mint(base()));
  assert.equal(r.state, 'VALID'); assert.equal(r.ok, true); assert.deepEqual(r.tools, TOOLS);
  assert.equal(r.customer, 'Test Co'); assert.equal(r.daysRemaining, 60);
  assert.equal(allowsTool(r, 'compress_context'), true); assert.equal(allowsTool(r, 'generate_embeddings'), false);
  assert.equal(warningHeader(r), null);
});
t('changing one byte of the payload breaks the signature', () => {
  const good = mint(base());
  const [body, sig] = good.slice(PREFIX.length).split('.');
  const forged = b64u(JSON.stringify({ ...base(), exp: NOW + 3650 * DAY }));
  assert.notEqual(forged, body);
  assert.equal(check(PREFIX + forged + '.' + sig).state, 'INVALID');
});
t('a token signed with another key (e.g. Over Watch\'s) is INVALID', () => assert.equal(check(mint(base(), other.privateKey)).state, 'INVALID'));
t('an Over Watch style prefix is INVALID', () => assert.equal(check(mint(base(), test.privateKey, 'EVO-LIC.v1.')).state, 'INVALID'));
t('a correctly signed licence for another product is INVALID', () => assert.equal(check(mint(base({ prod: 'over-watch' }))).state, 'INVALID'));
t('an unknown schema version is INVALID', () => assert.equal(check(mint(base({ ver: 2 }))).state, 'INVALID'));
t('not-yet-valid is INVALID', () => assert.equal(check(mint(base({ nbf: NOW + DAY }))).state, 'INVALID'));
t('garbage is INVALID', () => { for (const g of ['x', PREFIX, PREFIX + 'a.b.c', PREFIX + '!!.??']) assert.equal(check(g).state, 'INVALID', g); });
t('within the warning window is EXPIRING_SOON and warns', () => {
  const r = check(mint(base({ exp: NOW + 5 * DAY })));
  assert.equal(r.state, 'EXPIRING_SOON'); assert.equal(r.ok, true); assert.match(warningHeader(r), /expires in 5 day/);
});
t('past expiry but inside grace still works, with a warning', () => {
  const r = check(mint(base({ exp: NOW - 2 * DAY, grace: 7 })));
  assert.equal(r.state, 'GRACE'); assert.equal(r.ok, true); assert.match(warningHeader(r), /5 grace day/);
});
t('past grace is EXPIRED', () => {
  const r = check(mint(base({ exp: NOW - 8 * DAY, grace: 7 })));
  assert.equal(r.state, 'EXPIRED'); assert.equal(r.ok, false); assert.equal(allowsTool(r, 'compress_context'), false);
});
t('a revoked licence id is REVOKED', () => assert.equal(check(mint(base({ lid: 'amcp_revoked' }))).state, 'REVOKED'));
t('"*" is NOT a wildcard', () => assert.equal(allowsTool(check(mint(base({ ent: { tools: ['*'] } }))), 'compress_context'), false));
t('headers: Bearer (any case), x-astermind-license, mixed-case names', () => {
  assert.equal(tokenFromHeaders({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(tokenFromHeaders({ Authorization: 'bearer  abc ' }), 'abc');
  assert.equal(tokenFromHeaders({ 'X-AsterMind-License': 'abc' }), 'abc');
  assert.equal(tokenFromHeaders({}), '');
});
t('the production key list is exactly one Ed25519 public key and no private key', () => {
  assert.equal(PUBLIC_KEYS.length, 1);
  assert.match(PUBLIC_KEYS[0].pem, /^-----BEGIN PUBLIC KEY-----\n/);
  assert.doesNotMatch(PUBLIC_KEYS.map((k) => k.pem).join(''), /PRIVATE/);
  // a token from the throwaway key must NOT verify against production
  assert.equal(makeLicenseChecker({ now: () => NOW })(mint(base())).state, 'INVALID');
});

// --- the gate in the Lambda handler (stand-in engine; the real engine is unaffected by the licence) ---------
const dir = mkdtempSync(join(tmpdir(), 'amcp-lambda-'));
try {
  copyFileSync(join(HERE, 'lambda.mjs'), join(dir, 'lambda.mjs'));
  copyFileSync(join(HERE, 'license.mjs'), join(dir, 'license.mjs'));
  const fns = ['rerankDocuments', 'filterContext', 'classifyText', 'detectLanguage', 'semanticSearch', 'generateEmbeddings', 'compareTexts', 'estimateSavings'];
  writeFileSync(join(dir, 'engine.js'),
    fns.map((f) => `export const ${f} = () => ({ stub: '${f}' });`).join('\n') +
    `\nexport const countTokens = (t) => String(t || '').length;\n` +
    `export const compressContext = () => ({ totalDocs: 10, keptDocs: 3, tokensBefore: 100, tokensAfter: 30, tokensSaved: 70, percentSaved: 70, context: 'ctx' });\n`);
  const { makeHandler } = await import(pathToFileURL(join(dir, 'lambda.mjs')).href);
  const handler = makeHandler({ checkLicense: check });
  const call = async (method, path, headers = {}, body) => {
    const r = await handler({ requestContext: { http: { method } }, rawPath: path, headers, body: body && JSON.stringify(body) });
    return { status: r.statusCode, headers: r.headers, body: r.body ? JSON.parse(r.body) : null };
  };
  const bearer = (tok) => ({ authorization: 'Bearer ' + tok });

  for (const p of ['/', '/health', '/demo']) assert.equal((await call('GET', p)).status, 200, p + ' stays open'), passed++;
  let r = await call('POST', '/v1/compress_context', {}, {});
  assert.equal(r.status, 401); assert.equal(r.body.error, 'LICENSE_MISSING'); assert.match(r.headers['www-authenticate'], /Bearer/); passed++;
  r = await call('POST', '/v1/compress_context', bearer('AMCP-LIC.v1.junk.junk'), {});
  assert.equal(r.status, 403); assert.equal(r.body.error, 'LICENSE_INVALID'); passed++;
  r = await call('POST', '/v1/compress_context', bearer(mint(base())), { query: 'q', documents: ['a'] });
  assert.equal(r.status, 200); assert.equal(r.body.tool, 'compress_context'); passed++;
  r = await call('POST', '/v1/generate_embeddings', bearer(mint(base())), { texts: ['a'] });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'LICENSE_TOOL_NOT_INCLUDED'); passed++;
  r = await call('POST', '/v1/compress_context', bearer(mint(base({ exp: NOW - 30 * DAY }))), {});
  assert.equal(r.status, 403); assert.equal(r.body.error, 'LICENSE_EXPIRED'); passed++;
  r = await call('POST', '/v1/count_tokens', { 'x-astermind-license': mint(base({ exp: NOW + 3 * DAY })) }, { text: 'abc' });
  assert.equal(r.status, 200); assert.match(r.headers['x-astermind-license-warning'], /expires in 3 day/); passed++;
  r = await call('POST', '/v1/no_such_tool', {}, {});
  assert.equal(r.status, 404); passed++;
  r = await call('GET', '/license', bearer(mint(base())));
  assert.equal(r.status, 200); assert.equal(r.body.license.state, 'VALID'); assert.equal(r.body.license.customer, 'Test Co');
  assert.doesNotMatch(JSON.stringify(r.body), /AMCP-LIC/, 'the token is never echoed back'); passed++;
  r = await call('GET', '/license', bearer(mint(base({ exp: NOW - 30 * DAY }))));
  assert.equal(r.status, 200); assert.equal(r.body.license.state, 'EXPIRED'); passed++;
  r = await call('GET', '/license');
  assert.equal(r.status, 401); passed++;
  r = await call('OPTIONS', '/v1/compress_context');
  assert.equal(r.status, 204); assert.match(r.headers['access-control-allow-headers'], /authorization/); passed++;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`licence tests: ${passed} passed`);
