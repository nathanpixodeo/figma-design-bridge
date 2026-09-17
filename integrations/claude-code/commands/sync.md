---
description: Pull a Figma file or node into the local cache through the REST API
argument-hint: <figma-url-or-file-key> [node-id ...]
---

Load a design into the bridge cache so the other commands have something to read. Argument: `$ARGUMENTS` — a Figma design URL (a node id in the URL is honoured), or a bare file key followed by optional node ids.

Call `sync_figma_design` with `source` set to the URL or file key, and `node_ids` when specific nodes were named. This reaches the Figma REST API, so call it only when asked to sync or refresh — every call spends API quota, and the cached copy is usually current enough.

Confirm the result with `get_design_info` and report the page name, node count, and sync time.

If the call fails for a missing token, say so directly: the server needs `FIGMA_ACCESS_TOKEN` with the `file_content:read` scope in its own environment, and that is a change to how the MCP server is launched, not something this command can fix. The token-free alternative is the Figma plugin's **Sync Full Page** or **Sync Selected Nodes**, which pushes the current page to the running bridge without any REST access at all.

Never print the token, and never echo an environment variable that might hold it.
