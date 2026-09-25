# Go-Live — First Paying Customer (current reality)

This supersedes the admin-heavy path in `SALES-CYCLE-RUNBOOK.md`. Two blockers in that runbook are
**already solved** and change the critical path:

- **Minting is solved on-box.** The Ed25519 signing key lives on this box
  (`license-server/signing-key.pem`); prod already verifies on-box licences. No Mac, no Secrets-Manager
  access needed. Proven live this build (a minted licence returns `VALID` at `mcp.astermind.ai/license`).
- **Fulfilment is built and proven.** `billing/mint-worker.mjs` polls Stripe, fulfils **only** MCP
  subscriptions, and mints + delivers the licence. It ran live in DRY_RUN, correctly skipped the 2 real
  cyber subscriptions, and its minted licence verified on prod. No S3 grant and no new webhook required,
  so **the Over Watch webhook cross-fire risk is designed out** of fulfilment.

So the technical revenue chain works today. What remains is genuinely yours to decide/authorize.

## The short path to customer #1

### Step 1 — Clear the ONE safety gate (5 min, only you can confirm)
The account's Over Watch webhook (`we_1SWOdyH6...`) listens to `customer.subscription.created` at the
account level, so activating the MCP Buy link means the first MCP purchase's `subscription.created`
event is **also** delivered to the Over Watch pipeline. The MCP subscription carries
`metadata.licenseCode=astermind-mcp` / `product=mcp`.

**Confirm the Over Watch handler ignores subscriptions whose `licenseCode` is `astermind-mcp`.**
(Owner: you / Tim / Coen.) If it does, you're clear. If it might act on them, we isolate the MCP
purchase further before activating. This is the only item that blocks taking money and it is not
something agents can verify — it's your handler.

### Step 2 — Activate the Buy link (30 sec)
Once Step 1 is clear, say the word and I'll flip it, or run:
```bash
curl -s -X POST https://api.stripe.com/v1/payment_links/plink_1UJQZdH6Kuvzng7CymANZAp4 \
  -H "Authorization: Bearer $STRIPE_KEY_API_KEY" -d active=true
```
Buy URL: https://buy.stripe.com/9B67sL9jOfDo0AVgBn3cc00  ·  price: $19/mo  ·  metadata already correct.

### Step 3 — Be customer #1 (recommended, this week)
Subscribe AsterMind itself via that link (see `FIRST-CUSTOMER-PACKAGE.md`). On payment:
- Run `node billing/mint-worker.mjs` — it issues the licence to `billing/outbox/` (or emails it once
  SES is set). Send it to the buyer. First revenue on the books, whole chain exercised for real.

## To make fulfilment fully hands-off (optional, do after first sale)
1. **Verify an SES sender** (e.g. `licences@astermind.ai`) so the worker emails the licence itself.
   Set `AMCP_SES_FROM`. (Or swap in SendGrid/Resend — a 10-line change.)
2. **Schedule the worker** as a StarNet routine every ~5 min with `--send`. Idempotent, so it only ever
   issues one licence per subscription.

## Still-open discoverability (your one click)
- **MCP Registry** (`registry.modelcontextprotocol.io`): blocked on your interactive GitHub OAuth.
  Run `mcp-publisher login github`, authorize in the browser, then `mcp-publisher publish`. Everything
  else for the listing is prepared.
- Already live: **Smithery** (https://smithery.ai/servers/julian-fi9r/astermind-mcp) and **npm**.

## What agents CANNOT do (by design — your security model working)
Read the signing key from Secrets Manager, grant IAM, create AWS Budgets, verify the Over Watch
handler, complete OAuth logins, or move real money. Those stay with you.
