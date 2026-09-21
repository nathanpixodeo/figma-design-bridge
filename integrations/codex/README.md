# Codex CLI

Current Codex CLI releases support plugins, but this repository currently ships
Claude Code plugin metadata only. For Codex, use the MCP registration below;
the prompt file is an optional manual aid rather than an installable Codex
plugin.

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

Add `FIGMA_ACCESS_TOKEN` to that `env` table only if you want `sync_figma_design`, which pulls a Figma URL through the REST API. The Figma plugin path needs no Figma token — but it does need the local bridge token, which `npm run bridge:token` prints and which you paste into the plugin's **Bridge token** field once.

`FIGMA_BRIDGE_DATA_DIR` is not optional in practice. Without it the server derives its data directory from its own location, so a second clone silently reads an empty cache and reports that no design is loaded. Point this variable and the HTTP server (`node server/index.js`) at the same directory.

Check it with `codex mcp list`.

## 2. Use the review prompt (optional)

The current Codex CLI help exposes no prompt installation command. Copy the
body of `integrations/codex/prompts/figma-verify.md` into a task when you want
the repeatable review instructions, or package those instructions into a
Codex skill in your own environment.

The prompt's MCP calls match the server: use `get_design_info` for the legacy
cache, or pass `source` to the live-aware tools when reviewing a specific Figma
file or node. `get_bridge_status` is available for setup diagnostics.

Codex skills are the supported reusable-instruction mechanism. This file can
be used as the body of a skill if you want a named reusable command.
