# Codex CLI

Current Codex CLI releases support plugins, but this repository currently ships
Claude Code plugin metadata only. For Codex, use the MCP registration below;
the prompt file is an optional manual aid rather than an installable Codex
plugin.

## 1. Register the MCP server

Replace `<REPO>` with the absolute path to your clone.

```bash
codex mcp add figma-bridge -- node <REPO>/server/mcp.mjs
```

Or write it into `~/.codex/config.toml` directly:

```toml
[mcp_servers.figma-bridge]
command = "node"
args = ["<REPO>/server/mcp.mjs"]
```

Add an `[mcp_servers.figma-bridge.env]` table with `FIGMA_ACCESS_TOKEN` only if you want `sync_figma_design`, which pulls a Figma URL through the REST API. The Figma plugin path needs no Figma token — but the plugin has to pair with the bridge once: press **Pair with bridge** in its panel and approve the code it shows with the `approve_figma_pairing` tool or `npm run bridge:pair -- <code>`. Pasting the output of `npm run bridge:token` under **Advanced** in the panel also works.

No data directory needs configuring. Codex, the Claude Code plugin and `npm start` all keep the token and the cache in the same per-user directory (see [Where data lives](../../README.md#where-data-lives)), so the Figma plugin stays paired whichever of them runs the bridge. Before 1.3.0 this setup needed `FIGMA_BRIDGE_DATA_DIR=<REPO>/server/data`. That value now counts as unset, so it does no harm, but you can remove it; any other value keeps the Codex server on a directory and a token apart from the others. While the shared directory is still empty, the first start copies the token and the cache from `server/data`.

Check it with `codex mcp list`.

Codex stops waiting for a tool call after `tool_timeout_sec` (60 seconds by default). The first live read of a large Figma page can take longer, and the read tools accept a `timeoutMs` of up to 120 seconds, so raise the limit in the same table:

```toml
[mcp_servers.figma-bridge]
command = "node"
args = ["<REPO>/server/mcp.mjs"]
tool_timeout_sec = 150
```

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
