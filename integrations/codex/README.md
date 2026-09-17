# Codex CLI

Codex has no plugin format, so the bridge is wired in as two separate pieces: the MCP server, and a prompt file.

## 1. Register the MCP server

Replace `<REPO>` with the absolute path to your clone.

```bash
codex mcp add figma-bridge \
  --env FIGMA_BRIDGE_DATA_DIR=<REPO>/server/data \
  -- node <REPO>/server/mcp.mjs
```

Or write it into `~/.codex/config.toml` directly:

```toml
[mcp_servers.figma-bridge]
command = "node"
args = ["<REPO>/server/mcp.mjs"]

[mcp_servers.figma-bridge.env]
FIGMA_BRIDGE_DATA_DIR = "<REPO>/server/data"
```

Add `FIGMA_ACCESS_TOKEN` to that `env` table only if you want `sync_figma_design`, which pulls a Figma URL through the REST API. The Figma plugin path needs no token.

`FIGMA_BRIDGE_DATA_DIR` is not optional in practice. Without it the server derives its data directory from its own location, so a second clone silently reads an empty cache and reports that no design is loaded. Point this variable and the HTTP server (`node server/index.js`) at the same directory.

Check it with `codex mcp list`.

## 2. Install the prompt

```bash
mkdir -p ~/.codex/prompts
cp integrations/codex/prompts/figma-verify.md ~/.codex/prompts/
```

Invoke it as `/figma-verify <figma-node-url> <path/to/component>`. Prompts load at session start, so restart Codex after copying.

OpenAI has deprecated custom prompts in favour of skills. The prompt still works; if it stops appearing after a Codex upgrade, that is the reason, and the file's body can be moved into a skill unchanged.
