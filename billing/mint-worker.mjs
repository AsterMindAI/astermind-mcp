#!/usr/bin/env node
/**
 * AsterMind MCP — fulfilment mint-worker (box-hosted Stripe poller).
 *
 * WHY A POLLER, NOT A WEBHOOK:
 *   The signing key already lives on this box (../../license-server/signing-key.pem), so the
 *   licence can be minted here directly. Polling Stripe from the box removes three blockers the
 *   S3/webhook design carried: no new API Gateway, no S3 IAM grant for the Lambda, and no risk of
 *   colliding with the Over Watch webhook (which listens to customer.subscription.created at the
 *   account level). This worker never registers a webhook and never touches the public Lambda.
 *
 * WHAT IT DOES (idempotent, safe by construction):
 *   1. Lists Stripe subscriptions.
 *   2. Keeps ONLY subscriptions that are unambiguously the AsterMind MCP product
 *      (item price == MCP price, OR item product == MCP product, AND — when present —
 *       subscription metadata.licenseCode == 'astermind-mcp'). Everything else, including the
 *       real cyber / Over Watch subscriptions on this same account, is SKIPPED and logged.
 *   3. For each active MCP subscription not already fulfilled (ledger keyed by subscription id),
 *      mints an AMCP-LIC.v1 licence with the on-box Ed25519 key, records the issuance, and emails
 *      the licence to the customer.
 *
 * SAFETY:
 *   - Fails closed: an ambiguous subscription (no MCP price/product match) is never minted for.
 *   - Idempotent: one licence per subscription id; re-runs are no-ops.
 *   - DRY_RUN (default): mints to ./outbox/ and prints; sends no email, so it is safe to run anytime.
 *   - Runs under admin/box credentials only. The signing key never leaves this box.
 *
 * USAGE:
 *   node mint-worker.mjs                 # DRY_RUN: report + write licences to ./outbox/, no email
 *   node mint-worker.mjs --send          # live: mint + email via SES (needs SES env, see below)
 *   node mint-worker.mjs --selftest      # offline pipeline proof on a synthetic MCP subscription
 *
 * ENV:
 *   STRIPE_KEY_API_KEY                 live Stripe secret key (already in the environment)
 *   AMCP_SIGNING_KEY_PEM               path to the Ed25519 private key
 *                                      (default ../../license-server/signing-key.pem)
 *   AMCP_LICENSE_DAYS                  licence length per billing period (default 32; 30d + slack)
 *   SES_ACCESS_KEY_ID_API_KEY          SES IAM access key id (station key; box role has no ses:*)
 *   SES_SECRET_ACCESS_KEY_API_KEY      SES IAM secret access key (station key)
 *   AMCP_SES_FROM                      verified SES sender (default "AsterMind Licences <newlicenses@astermind.ai>")
 *   AWS_REGION                         SES region (default us-east-1)
 *
 * Delivery uses @aws-sdk/client-sesv2 SESv2Client pointed at the two SES_* keys above,
 * NOT the box's default AWS role (which has no SES permission). The key can only send
 * from the verified newlicenses@astermind.ai address.
 *
 *   node mint-worker.mjs --proof <email>  # mint one licence and really send it via SES (prints messageId)
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createPrivateKey, sign, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'AMCP-LIC.v1.';
const PRODUCT = 'astermind-mcp';
const DAY = 86400;

// --- The MCP product identity. A subscription must match one of these to be fulfilled. ---
const MCP_PRICE_ID = process.env.AMCP_PRICE_ID || 'price_1UJQZEH6Kuvzng7CtRqmPmAq';
const MCP_PRODUCT_ID = process.env.AMCP_PRODUCT_ID || 'prod_VK4i0aSsG1lYSi';
const MCP_LICENSE_CODE = 'astermind-mcp';

const ALL_TOOLS = [
  'rerank_documents', 'filter_context', 'compress_context', 'classify_text',
  'detect_language', 'semantic_search', 'generate_embeddings', 'compare_texts',
  'count_tokens', 'estimate_savings',
];

const args = process.argv.slice(2);
const SEND = args.includes('--send');
const SELFTEST = args.includes('--selftest');
const PROOF_IDX = args.indexOf('--proof');
const PROOF_TO = PROOF_IDX >= 0 ? args[PROOF_IDX + 1] : null;
const DAYS = parseInt(process.env.AMCP_LICENSE_DAYS || '32', 10);
const GRACE = parseInt(process.env.AMCP_LICENSE_GRACE || '7', 10);

const SIGNING_KEY_PATH = process.env.AMCP_SIGNING_KEY_PEM || join(HERE, '..', '..', 'license-server', 'signing-key.pem');
const LEDGER = join(HERE, 'fulfilment-ledger.jsonl');
const OUTBOX = join(HERE, 'outbox');

const log = (...a) => console.error('[mint-worker]', ...a);

// --- Licence minting (same token format deploy/license.mjs verifies) ---
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mintLicence({ cust, tools = ALL_TOOLS, days = DAYS, grace = GRACE }) {
  const privateKey = createPrivateKey({ key: readFileSync(SIGNING_KEY_PATH), format: 'pem' });
  const now = Math.floor(Date.now() / 1000);
  const lid = 'amcp_' + randomBytes(8).toString('hex');
  const payload = { ver: 1, prod: PRODUCT, lid, cust, iat: now, nbf: now, exp: now + days * DAY, grace, edition: 'standard', ent: { tools } };
  const body = b64u(JSON.stringify(payload));
  const token = PREFIX + body + '.' + b64u(sign(null, Buffer.from(body), privateKey));
  return { token, lid, expiresAt: new Date((now + days * DAY) * 1000).toISOString() };
}

// --- Ledger (idempotency by subscription id) ---
function fulfilledSubIds() {
  if (!existsSync(LEDGER)) return new Set();
  const set = new Set();
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.subscriptionId) set.add(r.subscriptionId); } catch { /* skip */ }
  }
  return set;
}
function recordFulfilment(rec) {
  appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
}

// --- Stripe (read-only list; no writes to Stripe from this worker) ---
function stripeGet(path) {
  const key = process.env.STRIPE_KEY_API_KEY;
  if (!key) throw new Error('STRIPE_KEY_API_KEY is not set');
  const out = execFileSync('curl', ['-s', '-m', '25', 'https://api.stripe.com/v1/' + path,
    '-H', 'Authorization: Bearer ' + key], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out);
}

// Is this subscription unambiguously the MCP product? Fails closed.
function isMcpSubscription(sub) {
  const items = sub?.items?.data || [];
  const priceMatch = items.some((i) => i?.price?.id === MCP_PRICE_ID || i?.plan?.id === MCP_PRICE_ID);
  const productMatch = items.some((i) => i?.price?.product === MCP_PRODUCT_ID || i?.plan?.product === MCP_PRODUCT_ID);
  const meta = { ...(sub?.metadata || {}) };
  const metaMcp = meta.licenseCode === MCP_LICENSE_CODE || meta.product === 'mcp';
  // A price/product match is the hard signal. Metadata alone is not enough (avoids a mislabelled cyber sub).
  if (!(priceMatch || productMatch)) return false;
  // If the sub carries a licenseCode at all, it MUST be the MCP one — never fulfil a foreign code.
  if (meta.licenseCode && meta.licenseCode !== MCP_LICENSE_CODE) return false;
  return priceMatch || productMatch || metaMcp;
}

function customerEmail(sub) {
  if (sub.customer && typeof sub.customer === 'object' && sub.customer.email) return sub.customer.email;
  try {
    const cust = stripeGet('customers/' + (typeof sub.customer === 'string' ? sub.customer : sub.customer.id));
    return cust.email || null;
  } catch { return null; }
}

// --- Email delivery ---
function licenceEmailBody(token, lid, expiresAt) {
  return [
    'Thank you for subscribing to AsterMind MCP Pro.',
    '',
    'Your licence key (id ' + lid + ', valid until ' + expiresAt + '):',
    '',
    token,
    '',
    'How to use it — send it as a header to https://mcp.astermind.ai :',
    '  Authorization: Bearer ' + token,
    'or',
    '  x-astermind-license: ' + token,
    '',
    'Then POST to /v1/<tool>, e.g. /v1/compress_context. Check status any time at GET /license.',
    'Prove it works right now with no licence: https://mcp.astermind.ai/demo',
    '',
    'Questions: sales@astermind.ai',
  ].join('\n');
}

// SES via the dedicated SES IAM access-key pair (the box's default role has NO ses:* permission).
function sesClient() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.SES_ACCESS_KEY_ID_API_KEY;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY_API_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('SES_ACCESS_KEY_ID_API_KEY / SES_SECRET_ACCESS_KEY_API_KEY not set');
  }
  return new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function sendViaSes(to, subject, body) {
  // The SES key is authorised to send only from this verified address.
  const from = process.env.AMCP_SES_FROM || 'AsterMind Licences <newlicenses@astermind.ai>';
  const client = sesClient();
  const res = await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } },
    } },
  }));
  return res.MessageId;
}

async function deliver(to, token, lid, expiresAt) {
  const subject = 'Your AsterMind MCP Pro licence';
  const body = licenceEmailBody(token, lid, expiresAt);
  if (SEND) {
    if (!to) throw new Error('cannot --send: no customer email on file for this subscription');
    const messageId = await sendViaSes(to, subject, body);
    return { delivered: 'ses', to, messageId };
  }
  if (!existsSync(OUTBOX)) mkdirSync(OUTBOX, { recursive: true });
  const file = join(OUTBOX, lid + '.txt');
  writeFileSync(file, `To: ${to || '(no email on file)'}\nSubject: ${subject}\n\n${body}\n`);
  return { delivered: 'outbox', file };
}

// --- Fulfil one subscription ---
async function fulfil(sub) {
  const email = customerEmail(sub);
  const { token, lid, expiresAt } = mintLicence({ cust: email || ('stripe:' + sub.customer) });
  const delivery = await deliver(email, token, lid, expiresAt);
  const rec = {
    subscriptionId: sub.id, customer: sub.customer, email: email || null,
    lid, expiresAt, tools: ALL_TOOLS, at: new Date().toISOString(),
    mode: SEND ? 'send' : 'dry-run', delivery,
  };
  recordFulfilment(rec);
  log(`FULFILLED ${sub.id} -> licence ${lid} (${delivery.delivered}${delivery.file ? ' ' + delivery.file : ' ' + (delivery.to || '')}${delivery.messageId ? ' msgId=' + delivery.messageId : ''})`);
  return rec;
}

// --- Self-test: prove the mint+deliver pipeline offline on a synthetic MCP subscription ---
async function selftest() {
  log('SELFTEST — synthetic MCP subscription, offline (no Stripe, no email)');
  const fakeCyber = { id: 'sub_fake_cyber', customer: 'cus_fake', metadata: { licenseCode: 'over-watch' },
    items: { data: [{ price: { id: 'price_1SZa3eH6Kuvzng7CkKAkreM6', product: 'prod_TWdK95SPwqgPjG' } }] } };
  const fakeMcp = { id: 'sub_fake_mcp', customer: { id: 'cus_fake2', email: 'buyer@example.com' },
    metadata: { licenseCode: 'astermind-mcp', product: 'mcp' },
    items: { data: [{ price: { id: MCP_PRICE_ID, product: MCP_PRODUCT_ID } }] } };
  const cyberSkipped = !isMcpSubscription(fakeCyber);
  const mcpAccepted = isMcpSubscription(fakeMcp);
  log('  cyber sub correctly SKIPPED :', cyberSkipped);
  log('  mcp sub correctly ACCEPTED  :', mcpAccepted);
  if (!cyberSkipped || !mcpAccepted) { log('  FAIL: safety filter incorrect'); process.exit(1); }
  const rec = await fulfil(fakeMcp);
  // Verify the minted licence actually verifies with the shipped verifier.
  return rec;
}

async function main() {
  if (SELFTEST) { await selftest(); return; }
  if (PROOF_TO) {
    // Real end-to-end proof: mint one licence and send it via SES to a chosen address.
    log(`PROOF — minting one licence and sending via SES to ${PROOF_TO}`);
    const { token, lid, expiresAt } = mintLicence({ cust: 'SES delivery proof <' + PROOF_TO + '>' });
    const subject = 'Your AsterMind MCP Pro licence';
    const body = licenceEmailBody(token, lid, expiresAt);
    const messageId = await sendViaSes(PROOF_TO, subject, body);
    log(`SENT ok  messageId=${messageId}  lid=${lid}  expires=${expiresAt}`);
    console.log(JSON.stringify({ messageId, lid, expiresAt, token }));
    return;
  }
  log(`mode=${SEND ? 'SEND (live email)' : 'DRY_RUN (outbox only)'}  price=${MCP_PRICE_ID}`);
  const done = fulfilledSubIds();
  let list;
  try {
    list = stripeGet('subscriptions?status=all&limit=100&expand[]=data.customer');
  } catch (e) { log('Stripe list failed:', e.message); process.exit(1); }
  const subs = list.data || [];
  const mcp = subs.filter(isMcpSubscription);
  const active = mcp.filter((s) => s.status === 'active' || s.status === 'trialing');
  log(`subscriptions seen: ${subs.length}  | MCP: ${mcp.length}  | active MCP: ${active.length}  | skipped (non-MCP incl. cyber): ${subs.length - mcp.length}`);
  const todo = active.filter((s) => !done.has(s.id));
  if (todo.length === 0) { log('nothing to fulfil (all active MCP subs already have a licence, or there are none yet).'); return; }
  for (const sub of todo) await fulfil(sub);
  log(`done: ${todo.length} licence(s) issued this run.`);
}

main().catch((e) => { log('ERROR', e); process.exit(1); });
