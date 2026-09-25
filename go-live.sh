#!/usr/bin/env bash
# AsterMind MCP — one-command go-live (npm + official MCP Registry).
# Product is already built and verified; this only performs the credential-gated publish.
#
# REQUIRED (as environment variables reachable by this shell):
#   GITHUB_TOKEN  GitHub PAT with 'repo' scope, whose owner is a member of the AsterMindAI org
#   NPM_TOKEN     npm "Automation" access token authorized for the @astermind scope
#
# USAGE:  cd astermind-mcp && GITHUB_TOKEN=xxx NPM_TOKEN=yyy bash go-live.sh
#
# Phases 1-2 (GitHub + npm) are the critical path. Phase 3 (registry) is best-effort:
# if the publisher CLI can't self-install, the package is still live on npm and you can
# run `mcp-publisher publish` by hand afterward.

set -euo pipefail
ORG="AsterMindAI"
REPO="astermind-mcp"
PKG="@astermind/astermind-mcp"
DESC="On-device MCP server that cuts RAG context tokens ~67% (measured). Nothing leaves the machine."

here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
export PATH="$HOME/.local/bin:$PATH"   # mcp-publisher v1.8.1 is pre-installed here

# Fall back to the station-connected keys if the explicit *_TOKEN vars aren't set.
GITHUB_TOKEN="${GITHUB_TOKEN:-${GITHUB_GOD_KEY_API_KEY:-${GITHUB_API_KEY:-}}}"
NPM_TOKEN="${NPM_TOKEN:-${NPM_API_KEY:-}}"

echo "== Preflight: required credentials (fail fast before any work) =="
: "${GITHUB_TOKEN:?set GITHUB_TOKEN or GITHUB_GOD_KEY_API_KEY (GitHub PAT with admin/push on $ORG/$REPO)}"
: "${NPM_TOKEN:?set NPM_TOKEN or NPM_API_KEY (npm AUTOMATION token for @astermind)}"
# Validate the npm token NOW so we fail before touching GitHub.
if npm whoami "--//registry.npmjs.org/:_authToken=$NPM_TOKEN" >/dev/null 2>&1; then
  echo "  npm token OK; GitHub token present"
else
  echo "  FATAL: npm token invalid (401). Create an npm 'Automation' token and set NPM_API_KEY in ABILITIES > KEYS."; exit 1
fi

echo "== Phase 0: re-verify before we ship =="
npm test
npm run benchmark

echo "== Phase 1: GitHub repo under $ORG =="
: "${GITHUB_TOKEN:?set GITHUB_TOKEN (PAT with 'repo' scope, member of $ORG)}"
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$ORG/$REPO" || true)
if [ "$code" = "404" ]; then
  curl -sf -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/orgs/$ORG/repos" \
    -d "{\"name\":\"$REPO\",\"private\":false,\"description\":\"$DESC\"}" >/dev/null
  echo "  created $ORG/$REPO"
else
  echo "  repo already exists (HTTP $code)"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$GITHUB_TOKEN@github.com/$ORG/$REPO.git"
git branch -M main
git push -u origin main
echo "  pushed -> https://github.com/$ORG/$REPO"

echo "== Phase 2: publish to npm =="
: "${NPM_TOKEN:?set NPM_TOKEN (npm automation token for @astermind)}"
# CLI-scoped auth beats any stale ./.npmrc or ~/.npmrc (highest npm config precedence).
npm publish --access public "--//registry.npmjs.org/:_authToken=$NPM_TOKEN"
echo "  published; verifying (name-check may lag a few seconds)..."
sleep 6
npm view "$PKG" version || echo "  (npm view lagging; check manually in ~1 min)"

echo "== Phase 3: official MCP Registry (best-effort) =="
set +e
if ! command -v mcp-publisher >/dev/null 2>&1; then
  ver=$(curl -s https://api.github.com/repos/modelcontextprotocol/registry/releases/latest \
        | grep -oE '"tag_name"\s*:\s*"[^"]+"' | head -1 | grep -oE 'v[0-9][^"]*')
  if [ -n "$ver" ]; then
    curl -sL "https://github.com/modelcontextprotocol/registry/releases/download/${ver}/mcp-publisher_${ver#v}_linux_amd64.tar.gz" -o /tmp/mp.tgz \
      && tar -xzf /tmp/mp.tgz -C "$HOME/.local/bin" mcp-publisher 2>/dev/null
  fi
fi
if command -v mcp-publisher >/dev/null 2>&1; then
  mcp-publisher login github --token "$GITHUB_TOKEN" 2>/dev/null || mcp-publisher login github
  mcp-publisher publish && echo "  registry publish submitted" || echo "  registry publish needs manual 'mcp-publisher publish'"
else
  echo "  mcp-publisher not installed automatically; install from github.com/modelcontextprotocol/registry and run 'mcp-publisher publish' (server.json is ready)"
fi
set -e

echo "== DONE =="
echo "  npm:      https://www.npmjs.com/package/$PKG"
echo "  github:   https://github.com/$ORG/$REPO"
echo "  registry: https://registry.modelcontextprotocol.io  (Smithery/Glama auto-index in 24-48h)"
echo "  next manual step: open the Awesome-MCP-Servers PR using the line in MARKETPLACE.md"
