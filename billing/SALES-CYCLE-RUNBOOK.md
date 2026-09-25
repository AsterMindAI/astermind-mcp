# AsterMind MCP — End-to-End Sales Cycle Runbook

Status as of this build. Live Stripe account `acct_1SUDorH6Kuvzng7C` (AsterMind AI Corporation, julian@astermind.ai), `livemode: true`. Only a LIVE Stripe key is available — there is no test key, so a Stripe test-mode dry run is not possible with current credentials.

## The customer journey (target)

```
Customer → Buy page (astermindai.com) → Stripe Checkout ($19/mo)
  → pays → Stripe fires checkout.session.completed
  → MCP webhook route writes mint request to S3 mint-queue/pending/
  → Commander's minting worker (holds Ed25519 signing key) mints licence, emails it
  → Customer pastes licence as Authorization: Bearer <licence>
  → POST /v1/<tool> at mcp.astermind.ai returns 200
```

Payment is the trigger. No payment, no mint. The signing key never touches the public Lambda or the agents.

## What is BUILT and VERIFIED (this build)

Live Stripe catalog objects, created and read back (all `livemode: true`):

| Object | ID | Detail |
|---|---|---|
| Product | `prod_VK4i0aSsG1lYSi` | "AsterMind MCP — Pro", metadata `licenseCode=astermind-mcp`, `managed_by=cybernetic-organism-mcp` (namespaced away from the Over Watch `managed_by=script` line) |
| Price | `price_1UJQZEH6Kuvzng7CtRqmPmAq` | $19.00/mo recurring, licensed, lookup_key `astermind_mcp_pro_monthly` |
| Buy link | `plink_1UJQZdH6Kuvzng7CymANZAp4` | URL `https://buy.stripe.com/9B67sL9jOfDo0AVgBn3cc00` — **currently INACTIVE** (cannot take a payment yet) |

The Buy link carries `subscription_data.metadata.licenseCode=astermind-mcp` so any fulfilment consumer can distinguish an MCP purchase from a cyber/Over Watch purchase.

Creating catalog objects fires no webhook. A payment link is inert until someone completes a payment. The link is deliberately deactivated so no one can pay before fulfilment exists.

## SAFETY GATE — Over Watch webhook cross-fire (must clear before activating the Buy link)

The existing production webhook `we_1SWOdyH6Kuvzng7Cp2kamz0j` →
`https://jkh8sd9wpk.execute-api.us-east-1.amazonaws.com/prod/stripe-webhook`
listens to `customer.subscription.created/updated/deleted` (NOT `checkout.session.completed`).

Because it listens to `customer.subscription.created`, the FIRST real MCP subscription purchase will ALSO be delivered to the Over Watch pipeline. The MCP subscription carries `metadata.licenseCode=astermind-mcp`, which the Over Watch script should not recognize — but that must be confirmed, not assumed.

REQUIRED before go-live: confirm the Over Watch webhook handler ignores subscriptions whose `licenseCode` is `astermind-mcp` (or `product=mcp`). Owner: Julian / Tim / Coen (they own that handler). If it does not cleanly ignore them, the MCP purchase must be isolated further before activation.

## Fulfilment wiring (agents building now, NOT deployed)

Chosen route to avoid needing new API Gateway permissions: add a dedicated webhook route to the EXISTING MCP Lambda function URL (POST `/billing/stripe-webhook`) rather than a separate API Gateway. It verifies the Stripe signature, filters `metadata.product == mcp`, and writes a mint request to `s3://starnet-manhunter-043206013264/mint-queue/pending/`. A NEW Stripe webhook endpoint listening ONLY to `checkout.session.completed` points at it — this event is not consumed by Over Watch, so MCP fulfilment and Over Watch never compete on the same event.

## GO-LIVE CHECKLIST (admin-only, in order)

1. Confirm the Over Watch webhook ignores `licenseCode=astermind-mcp` (safety gate above).
2. Set the AWS Budgets alert (`AWS-BUDGETS-SETUP.md`) — public endpoint.
3. Grant the MCP Lambda S3 write access to the mint queue (`IAM-POLICY-S3-MINT-QUEUE.json`).
4. Deploy the MCP webhook route (DEVOPS, from `main`, honoring the pull-main licence-check rule).
5. Register a NEW Stripe webhook endpoint for `checkout.session.completed` → the MCP webhook route, and store its `whsec_...` signing secret in Secrets Manager / ABILITIES › KEYS.
6. Configure email delivery of the licence (AWS SES or SendGrid) — the minting worker sends it.
7. Start the minting worker under admin credentials (reads the Ed25519 signing key from Secrets Manager):
   `cd ~/Documents/astermind-mcp/billing && node mint-worker.mjs`
8. Activate the Buy link:
   `POST https://api.stripe.com/v1/payment_links/plink_1UJQZdH6Kuvzng7CymANZAp4  active=true`
9. Put the Buy button on astermindai.com (pricing page from TECHWRITER).
10. Run the paid-path E2E test (QA): buy with a real card → receive licence email → POST /v1/compress_context returns 200. (Refund the test charge afterward.)

## Honest boundary

Agents built the front door (product, price, Buy link) and are building the fulfilment webhook. Agents CANNOT: read the signing key (by design), run the minting worker, configure SES, or confirm the Over Watch handler's behavior. Those are the admin/team actions above. Until steps 5–8 are done, no customer can complete a real purchase-to-licence cycle.
