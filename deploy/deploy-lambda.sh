#!/usr/bin/env bash
# Deploy the AsterMind hosted API to AWS Lambda (zip) + a public Function URL.
#
# Runs the REAL engine (../src/engine.js -> @astermind/astermind-community). No stubs.
# Requires an AWS identity that can manage starnet-* Lambdas and pass role
# starnet-lambda-exec (the StarNet agent's starnet-manhunter IAM user qualifies).
#
# Usage:  AWS_CLI=/home/starnet/.local/bin/aws ./deploy-lambda.sh
set -euo pipefail

AWS="${AWS_CLI:-/home/starnet/.local/bin/aws}"
REGION="${AWS_REGION:-us-east-1}"
FN="${FN:-starnet-astermind-mcp}"
ROLE="${ROLE:-arn:aws:iam::043206013264:role/starnet-lambda-exec}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"

echo "== assemble bundle =="
rm -rf "$BUILD"; mkdir -p "$BUILD"
cp "$HERE/../src/engine.js" "$BUILD/engine.js"
cp "$HERE/lambda.mjs"       "$BUILD/lambda.mjs"
cp "$HERE/license.mjs"      "$BUILD/license.mjs"
cp "$HERE/package.json"     "$BUILD/package.json"
( cd "$BUILD" && npm install --omit=dev --no-audit --no-fund )

echo "== zip =="
rm -f "$HERE/function.zip"
( cd "$BUILD" && zip -qr "$HERE/function.zip" . )
ls -lh "$HERE/function.zip"

echo "== create or update function =="
if $AWS lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  $AWS lambda update-function-code --function-name "$FN" \
    --zip-file "fileb://$HERE/function.zip" --region "$REGION" >/dev/null
else
  $AWS lambda create-function --function-name "$FN" --runtime nodejs22.x \
    --role "$ROLE" --handler lambda.handler --zip-file "fileb://$HERE/function.zip" \
    --timeout 30 --memory-size 1024 --architectures x86_64 \
    --description "AsterMind hosted API - real on-device token-reduction engine." \
    --region "$REGION" >/dev/null
fi
$AWS lambda wait function-active --function-name "$FN" --region "$REGION"

echo "== public Function URL =="
# mcp.astermind.ai (CloudFront) points at this exact URL: update its config in place, never delete/recreate it.
CORS='{"AllowOrigins":["*"],"AllowMethods":["GET","POST"],"AllowHeaders":["content-type","authorization","x-astermind-license"],"ExposeHeaders":["x-astermind-license-warning"]}'
$AWS lambda create-function-url-config --function-name "$FN" --auth-type NONE --cors "$CORS" \
  --region "$REGION" >/dev/null 2>&1 \
  || $AWS lambda update-function-url-config --function-name "$FN" --cors "$CORS" --region "$REGION" >/dev/null
# A public (auth NONE) Function URL needs BOTH permissions; with only the first one AWS answers 403.
$AWS lambda add-permission --function-name "$FN" --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE \
  --region "$REGION" >/dev/null 2>&1 || true
$AWS lambda add-permission --function-name "$FN" --statement-id FunctionURLInvokeAllowPublicAccess \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url \
  --region "$REGION" >/dev/null 2>&1 || true
URL=$($AWS lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)
echo "Function URL: $URL"
echo
echo "Verify via IAM (always works):"
echo "  $AWS lambda invoke --function-name $FN --region $REGION \\"
echo "    --cli-binary-format raw-in-base64-out \\"
echo "    --payload '{\"version\":\"2.0\",\"requestContext\":{\"http\":{\"method\":\"GET\"}},\"rawPath\":\"/demo\"}' /tmp/out.json && cat /tmp/out.json"
echo
echo "Verify publicly (only once the account permits anonymous Function URLs):"
echo "  curl ${URL}demo"
