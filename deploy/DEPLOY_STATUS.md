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
| Function URL | `https://ltjq56za2mg4r7yab23xd22gzu0iepbd.lambda-url.us-east-1.on.aws/` |

## Routes

- `GET  /` — service info + tool list
- `GET  /health` — liveness + engine version
- `GET  /demo` — zero-input live proof of token reduction
- `POST /v1/<tool>` — one of: `rerank_documents`, `filter_context`, `compress_context`,
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

## Open blocker: public (anonymous) access

The public Function URL returns **HTTP 403 Forbidden** even though:

- the URL `AuthType` is confirmed `NONE`,
- the function's resource policy contains the exact canonical public-allow statement
  (`Principal:*`, `Action:lambda:InvokeFunctionUrl`, `Condition FunctionUrlAuthType=NONE`),
- we waited well past auth propagation (6 retries over 90 s),
- and a **direct IAM invoke of the same function returns 200**.

That combination means the request is rejected at the AWS Function-URL auth boundary
**before** it reaches the code — i.e. an account/organization guardrail (an SCP or a
permissions boundary) is denying anonymous Function URL invocation. The `starnet-manhunter`
IAM user cannot see or change org SCPs, so this needs an admin action.

### Two doors to public reach (admin choice)

1. **Allow public Function URLs** for `starnet-*` functions from the admin account
   (`julian@astermind.ai`). Nothing else changes — the endpoint is instantly public.
2. **Publish the package** (`@astermind/astermind-mcp`) to npm with an Automation token,
   which is how MCP clients discover and install servers via `npx`. The GitHub repo is
   already live at https://github.com/AsterMindAI/astermind-mcp .

An interim option that works today without any admin change: switch the Function URL to
`AuthType AWS_IAM` and give consumers SigV4-signed access (authenticated, not anonymous).

## Redeploy

```bash
AWS_CLI=/home/starnet/.local/bin/aws ./deploy-lambda.sh
```
