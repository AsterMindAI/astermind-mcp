# AsterMind hosted API — AWS deployment status

**As of this deploy run.** Everything below is verified by real AWS output, not asserted.

## What is live

| Item | Value |
|---|---|
| Lambda function | `starnet-astermind-mcp` |
| ARN | `arn:aws:lambda:us-east-1:043206013264:function:starnet-astermind-mcp` |
| Region | `us-east-1` |
| Runtime / handler | `nodejs22.x` / `lambda.handler` |
| Memory / timeout | 1024 MB / 30 s |
| Role | `starnet-lambda-exec` (passed at create) |
| Engine | `@astermind/astermind-community@3.0.0` (real, not a stub) |
| Function URL | `https://ltjq56za2mg4r7yab23xd22gzu0iepbd.lambda-url.us-east-1.on.aws/` (CloudFront's origin: **never delete or recreate it**) |
| Public address | `https://mcp.astermind.ai` → CloudFront `EFQF4JAC11TCN` (ACM certificate for `mcp.astermind.ai`) → the Function URL |
| Concurrency cap | 10 reserved concurrent executions (cost ceiling; change only with the owner's OK) |

## Routes

- `GET  /` — service info + tool list (open)
- `GET  /health` — liveness + engine version (open)
- `GET  /demo` — zero-input live proof of token reduction (open)
- `GET  /license` — the caller's licence status (licence header required)
- `POST /v1/<tool>` — **licence required, and the licence must include the tool** — one of: `rerank_documents`, `filter_context`, `compress_context`,
  `classify_text`, `detect_language`, `semantic_search`, `generate_embeddings`,
  `compare_texts`, `count_tokens`, `estimate_savings`

## Verified working (IAM invoke)

Direct invoke returns `StatusCode 200`. `GET /demo` output, computed live on the request:

```
totalDocs: 10, keptDocs: 3
tokensBefore: 234  ->  tokensAfter: 83
tokensSaved: 151   ->  percentSaved: 64.5%
```

The engine kept exactly the 3 password-relevant docs out of 10 and dropped the rest.
This is real BPE token counting (`gpt-tokenizer`) over the real ELM reranker — it does
what we advertise.

Reproduce:

```bash
AWS=/home/starnet/.local/bin/aws
$AWS lambda invoke --function-name starnet-astermind-mcp --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"version":"2.0","requestContext":{"http":{"method":"GET"}},"rawPath":"/demo"}' \
  /tmp/out.json && cat /tmp/out.json
```

## Public access (resolved)

The earlier HTTP 403 on the public Function URL was **not** an SCP. SCPs never apply to this account,
because it is the organisation's management account. A public (`AuthType NONE`) Function URL needs
**two** resource-policy statements, and the function had only the first:

- `lambda:InvokeFunctionUrl` with `lambda:FunctionUrlAuthType = NONE` (statement `FunctionURLAllowPublicAccess`)
- `lambda:InvokeFunction` with `lambda:InvokedViaFunctionUrl = true` (statement `FunctionURLInvokeAllowPublicAccess`)

Both are now in place, and `deploy-lambda.sh` adds both, so a fresh deploy cannot regress to 403.

## Licences

`POST /v1/<tool>` requires an AsterMind MCP licence, sent as `Authorization: Bearer AMCP-LIC.v1.…`
(or `x-astermind-license: AMCP-LIC.v1.…`). Format and checks are in `license.mjs`; tests in
`license.test.mjs` (`node deploy/license.test.mjs`).

- Same design as Over Watch's licence (offline Ed25519 signature, public key baked into the code), with
  its **own** key pair, so an MCP licence never unlocks Over Watch and vice versa.
- The licence lists the tools it grants explicitly; a tool it does not list answers
  `403 LICENSE_TOOL_NOT_INCLUDED`.
- Responses: no licence `401 LICENSE_MISSING`; bad or foreign licence `403 LICENSE_INVALID`; past expiry
  plus grace `403 LICENSE_EXPIRED`; revoked `403 LICENSE_REVOKED`. Inside the last 14 days, and during
  grace, calls still work and carry an `x-astermind-license-warning` header.
- **Revoke** a licence without redeploying: add its licence id to the function's `AMCP_REVOKED_LIDS`
  environment variable (comma-separated).
- **Minting is not in this repository.** The private signing key lives only in AWS Secrets Manager
  (`astermind/license/astermind-mcp/ed25519-signing-key`) and is used by AsterMind's private minting tool,
  which also keeps the issuance ledger. StarNet agents have no access to it.

## Redeploy

```bash
AWS_CLI=/home/starnet/.local/bin/aws ./deploy-lambda.sh
```
