# AsterMind MCP — Fulfilment mint-worker

`mint-worker.mjs` turns a paid Stripe subscription into a delivered licence, automatically, from
this box. It replaces the S3/webhook design in `SALES-CYCLE-RUNBOOK.md` and removes that design's
three blockers: no new API Gateway, no S3 IAM grant for the Lambda, and **no collision with the
Over Watch webhook** (this worker registers no webhook and polls Stripe read-only).

## Why this is safe around the live cyber / Over Watch subscriptions

This Stripe account carries **real paying cyber subscriptions** (product `prod_TWdK95SPwqgPjG`).
The worker fulfils a subscription **only** when it unambiguously matches the MCP product
(item price `price_1UJQZEH6Kuvzng7CtRqmPmAq` or product `prod_VK4i0aSsG1lYSi`), and it refuses any
subscription whose `metadata.licenseCode` is set to anything other than `astermind-mcp`. It fails
closed. Verified live: a dry run saw the 2 real cyber subscriptions, classified both as non-MCP, and
minted nothing.

## Proven this build

- `node mint-worker.mjs --selftest` — synthetic cyber sub SKIPPED, synthetic MCP sub ACCEPTED, licence minted.
- `node mint-worker.mjs` (live DRY_RUN) — `subscriptions seen: 2 | MCP: 0 | active MCP: 0 | skipped: 2`.
- The licence the worker produced verified **VALID on production** (`GET https://mcp.astermind.ai/license`)
  with all 10 tools — the whole pay→mint→deliver output is real, minus the live email send.

## Run it

```bash
# from astermind-mcp/billing
node mint-worker.mjs            # DRY_RUN: writes licences to ./outbox/, sends no email (safe anytime)
node mint-worker.mjs --send     # live: mints + emails via SES (needs SES env below)
node mint-worker.mjs --selftest # offline pipeline proof
```

Idempotent: one licence per subscription id, recorded in `fulfilment-ledger.jsonl` (git-ignored).
Re-running is a no-op for already-fulfilled subs. For continuous operation, drive it with a StarNet
routine (e.g. every 5 minutes) rather than a cron daemon.

## Requirements for live `--send`

| Env | Purpose |
|---|---|
| `STRIPE_KEY_API_KEY` | live Stripe secret (already in the box environment) |
| `AMCP_SIGNING_KEY_PEM` | path to Ed25519 key (default `../../license-server/signing-key.pem`) |
| `AMCP_SES_FROM` | a **verified** SES sender, e.g. `AsterMind <licences@astermind.ai>` |
| `AWS_REGION` | SES region (default `us-east-1`) |

The only new admin prerequisite for automated email is a verified SES identity (or swap
`sendViaSes` for a SendGrid/Resend call). Until then, DRY_RUN drops the licence in `outbox/` and a
human can send it — which is enough to fulfil the very first customer by hand.
