/**
 * Licence check for the AsterMind hosted API (mcp.astermind.ai).
 *
 * Same design as Over Watch's product licence (EVO-LIC.v1, ADR-22336): an offline Ed25519-signed token,
 * verified here with a baked-in PUBLIC key, no database and no phone-home. It uses its OWN key pair, so an
 * MCP licence can never unlock Over Watch and an Over Watch licence can never unlock this API.
 *
 *   AMCP-LIC.v1.<base64url(canonical JSON payload)>.<base64url(Ed25519 signature)>
 *
 * The signature covers the exact base64url payload text, so verification never depends on re-serialising
 * JSON. Payload fields:
 *   ver      1                        schema version (anything else is refused)
 *   prod     "astermind-mcp"          product binding (anything else is refused)
 *   lid      "amcp_..."               licence id: shown to the customer, used for revocation
 *   cust     "Acme Corp"              customer name
 *   iat/nbf/exp  unix seconds         issued / not-before / expires
 *   grace    days                     keeps working this many days past exp, with a warning header
 *   edition  "standard"               display only
 *   ent.tools ["compress_context",…]  EXPLICIT tool list. There is no wildcard: the minting tool expands
 *                                     "all" into names (Over Watch learned that "*" silently granted nothing).
 *
 * The private key lives only in AWS Secrets Manager (astermind/license/astermind-mcp/ed25519-signing-key)
 * and is used only by the minting tool; it is never in this repository or in the Lambda.
 */
import { createPublicKey, verify } from 'node:crypto';

export const PREFIX = 'AMCP-LIC.v1.';
export const PRODUCT = 'astermind-mcp';
export const WARN_DAYS = 14;
const DAY = 86400;

// Production verifying keys. An ARRAY so a key rotation can ship old + new together for one release.
export const PUBLIC_KEYS = [
  {
    kid: 'amcp-2026-09',
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAC6qLYv8vVbrTLtzg1NfGlbR+L/EqD2nHRaN8VJRtadg=\n-----END PUBLIC KEY-----\n',
  },
];

const b64uDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The licence token from a request's headers: `Authorization: Bearer <token>` or `x-astermind-license`. */
export function tokenFromHeaders(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[String(k).toLowerCase()] = String(v);
  const auth = (h.authorization || '').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return (h['x-astermind-license'] || '').trim();
}

/**
 * makeLicenseChecker({ publicKeys, now, revoked }) -> check(token) -> result
 *   publicKeys: [{ kid, pem }]           (defaults to the production keys above)
 *   now:        () => unix seconds       (injectable for tests)
 *   revoked:    () => Set of lid strings (defaults to AMCP_REVOKED_LIDS, comma-separated, read per call)
 *
 * result.state is one of MISSING, INVALID, REVOKED, VALID, EXPIRING_SOON, GRACE, EXPIRED.
 * result.ok is true for VALID, EXPIRING_SOON and GRACE.
 */
export function makeLicenseChecker(opts = {}) {
  const keys = (opts.publicKeys || PUBLIC_KEYS).map((k) => ({ kid: k.kid, key: createPublicKey({ key: k.pem, format: 'pem' }) }));
  const now = opts.now || (() => Math.floor(Date.now() / 1000));
  const revoked = opts.revoked || (() => new Set(String(process.env.AMCP_REVOKED_LIDS || '').split(',').map((s) => s.trim()).filter(Boolean)));
  const invalid = (reason) => ({ ok: false, state: 'INVALID', reason });

  return function check(token) {
    if (!token) return { ok: false, state: 'MISSING', reason: 'No licence was sent' };
    if (typeof token !== 'string' || !token.startsWith(PREFIX)) return invalid('Not an AsterMind MCP licence (expected AMCP-LIC.v1.…)');
    const parts = token.slice(PREFIX.length).split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return invalid('Malformed licence');
    const [body, sig] = parts;
    if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return invalid('Malformed licence');
    const signature = b64uDecode(sig);
    if (!keys.some((k) => verify(null, Buffer.from(body), k.key, signature))) return invalid('Signature does not verify');
    let p;
    try { p = JSON.parse(b64uDecode(body).toString('utf8')); } catch { return invalid('Unreadable payload'); }
    if (!p || p.ver !== 1) return invalid('Unsupported licence version');
    if (p.prod !== PRODUCT) return invalid('Licence is for a different product');
    if (!Number.isInteger(p.exp) || !Number.isInteger(p.nbf)) return invalid('Licence has no valid dates');
    if (!p.ent || !Array.isArray(p.ent.tools)) return invalid('Licence lists no tools');

    const t = now();
    const grace = Number.isInteger(p.grace) && p.grace >= 0 ? p.grace : 0;
    const info = {
      licenseId: p.lid, customer: p.cust, edition: p.edition || '', tools: p.ent.tools.slice(),
      issuedAt: p.iat, expiresAt: p.exp,
      daysRemaining: Math.floor((p.exp - t) / DAY),
      graceDaysRemaining: Math.max(0, Math.ceil((p.exp + grace * DAY - t) / DAY)),
    };
    if (t < p.nbf) return { ...invalid('Licence is not valid yet'), ...info };
    if (revoked().has(p.lid)) return { ok: false, state: 'REVOKED', reason: 'This licence has been revoked', ...info };
    if (t >= p.exp + grace * DAY) return { ok: false, state: 'EXPIRED', reason: 'Licence expired', ...info };
    if (t >= p.exp) return { ok: true, state: 'GRACE', reason: 'Licence expired; grace period running', ...info };
    if (t >= p.exp - WARN_DAYS * DAY) return { ok: true, state: 'EXPIRING_SOON', reason: 'Licence expires soon', ...info };
    return { ok: true, state: 'VALID', reason: '', ...info };
  };
}

/** Does this licence (a check() result with ok:true) include the named tool? Exact match only. */
export function allowsTool(result, tool) {
  return !!(result && result.ok && Array.isArray(result.tools) && result.tools.includes(tool));
}

/** A header to send while the licence still works but needs renewing, or null. */
export function warningHeader(result) {
  if (!result || !result.ok) return null;
  if (result.state === 'EXPIRING_SOON') return `licence ${result.licenseId} expires in ${result.daysRemaining} day(s)`;
  if (result.state === 'GRACE') return `licence ${result.licenseId} has expired; ${result.graceDaysRemaining} grace day(s) left`;
  return null;
}
