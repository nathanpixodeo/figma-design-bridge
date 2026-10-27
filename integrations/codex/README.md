# Codex CLI

Codex installs Figma Design Bridge as a plugin, from the same marketplace as
Claude Code. One command sets it up, along with Claude Code, agy and Gemini CLI
if they are installed:

```bash
npx -y @pixodeo/figma-bridge@latest setup
```

With the `figma-bridge` command already installed, set up Codex alone:

```bash
figma-bridge setup --only codex
```

This adds the `figma-design-bridge` marketplace from the installed package, then
runs `codex plugin add figma-bridge@figma-design-bridge`. It respects
`CODEX_HOME`. Restart running Codex sessions afterwards, and check it with
`figma-bridge status` or `codex mcp list`, which lists the plugin's server as
`bridge`.

The plugin's MCP server needs no Figma token for the plugin path, but the Figma
plugin has to pair with the bridge once: press **Pair with bridge** in its panel
and approve the code it shows with the `approve_figma_pairing` tool or
`figma-bridge pair <code>`. Only `sync_figma_design`, which pulls a Figma URL
through the REST API, needs `FIGMA_ACCESS_TOKEN` in the server's environment.

No data directory needs configuring. Codex, Claude Code, agy, Gemini CLI and
`figma-bridge start` all keep the token and the cache in the same per-user
directory (see [Where data lives](../../README.md#where-data-lives)), so the
Figma plugin stays paired whichever of them runs the bridge.

## Approvals

The read tools are marked `readOnlyHint`, so Codex runs them without asking.
`approve_figma_pairing` and `sync_figma_design` still ask. To make every bridge
tool ask:

```bash
figma-bridge approvals manual
```

The command sets the other clients on the machine at the same time; see
[Approvals](../../README.md#approvals). For Codex, it writes this table into `$CODEX_HOME/config.toml`;
`figma-bridge approvals auto` removes it again. The first time setup changes
the file, it keeps the file as it was in `config.toml.figma-bridge.bak`.

```toml
[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]
default_tools_approval_mode = "prompt"
```

The plugin also ships `hooks/hooks.json`, the hook that lets Claude Code run
reads without asking. Codex may list that hook and ask whether to trust it. It
only answers for Claude Code's tool names, so it changes nothing in Codex
either way.

## Timeouts

Codex stops waiting for a tool call after its tool timeout, 60 seconds by
default. The first live read of a large Figma page can take longer. If a read
times out in Codex, read one screen frame rather than a whole section, or pass a
smaller `depth` or `maxNodes`.

## Upgrading from a hand-added server

Before 1.4.0 this guide registered the server by hand, with
`codex mcp add figma-bridge -- node <REPO>/server/mcp.mjs`. That entry and the
plugin would both run the bridge, so setup points it out. Remove it with:

```bash
codex mcp remove figma-bridge
```

A `FIGMA_BRIDGE_DATA_DIR=<REPO>/server/data` left in its environment from before
1.3.0 counts as unset, and the first start copies the token and the cache from
`server/data` while the shared directory is still empty.

## Use the review prompt (optional)

Copy the body of `integrations/codex/prompts/figma-verify.md` into a task when
you want the repeatable review instructions, or package those instructions into
a Codex skill in your own environment.

The prompt's MCP calls match the server: use `get_design_info` for the legacy
cache, or pass `source` to the live-aware tools when reviewing a specific Figma
file or node. `get_bridge_status` is available for setup diagnostics.
