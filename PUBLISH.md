# AsterMind MCP — Go-Live Runbook

The package is publish-ready. Everything below is verified locally; the steps that actually push to
npm / GitHub / the MCP Registry / AWS need your credentials and are marked **[needs your auth]**.

## Status of prerequisites on this machine (checked 2026-09-24)

| Tool | State | Needed for |
|---|---|---|
| Node 22 / npm 9 | present | build & test |
| npm login | **not logged in** | `npm publish` |
| `gh` CLI | **not installed** | create GitHub repo |
| `aws` CLI | **not installed** | optional AWS hosting |
| git repo | initialized locally (see step 1) | version control |

## Phase 0 — verify (already passing)

```bash
npm install
npm test            # engine + MCP client round-trip — PASS
npm run benchmark   # regenerates benchmark/results.json — 66.8% saved, 100% answer-present
```

## Phase 1 — GitHub repo  **[needs your auth]**

The `mcpName` (`io.github.AsterMindAI/astermind-mcp`) requires the repo to live under the
`AsterMindAI` GitHub org, because the registry authenticates namespace ownership via GitHub OAuth.

```bash
# option A: with gh installed and logged in
gh repo create AsterMindAI/astermind-mcp --public --source=. --remote=origin --push

# option B: create the empty repo in the web UI, then
git remote add origin https://github.com/AsterMindAI/astermind-mcp.git
git push -u origin main
```

The local git repo is already initialized and committed (step done by the agent).

## Phase 2 — publish to npm  **[needs your auth]**

The scope `@astermind` must belong to your npm org and you must be logged in.

```bash
npm login                     # or set NPM_TOKEN in ~/.npmrc
npm publish --access public   # publishes @astermind/astermind-mcp@0.1.0
```

Confirm: `npm view @astermind/astermind-mcp version` returns `0.1.0`.

## Phase 3 — official MCP Registry  **[needs your auth]**

The registry only stores metadata; npm must be published first (Phase 2).

```bash
# install the publisher CLI (from github.com/modelcontextprotocol/registry)
# then authenticate with GitHub (matches the io.github.AsterMindAI/ namespace)
mcp-publisher login github
mcp-publisher publish            # reads server.json in this directory
```

`server.json` is written and points at the npm package. Once accepted, **Smithery and Glama
auto-index within ~24–48h** — no separate submission for those.

## Phase 4 — manual directories

- **Awesome MCP Servers**: fork, add the line from `MARKETPLACE.md`, open a PR.
- **PulseMCP / mcp.so**: bot-protected; check their site for a submit form or rely on registry crawl.

## Phase 5 — optional AWS hosting  **[needs your auth]**

Only needed if you want a hosted HTTP/SSE endpoint in addition to the npx stdio distribution. Requires
the `aws` CLI installed and configured. The current server is stdio; hosting it needs a small
Streamable-HTTP wrapper (the MCP SDK supports it) plus an ECS/Fargate or Lambda target. Flag this when
you want it and I'll build the HTTP transport + Dockerfile + deploy scripts.

## What I could NOT do without you

- `npm publish` — machine is not logged in to npm under the `@astermind` scope.
- Create the GitHub repo — `gh` not installed and no stored GitHub credential.
- AWS deploy — `aws` CLI not installed.

Give me an npm token (ABILITIES › KEYS or `npm login`), install/authenticate `gh`, and I can execute
Phases 1–3 end to end and confirm each with a read-back.
