# Plugin-first, on-demand Figma MCP

Date: 2026-09-17
Status: implementation assigned to Claude; review and acceptance owned by Codex.

## 1. User outcome

Open the editable Figma copy, start Design Bridge, connect any local MCP client,
and paste a Figma link into the agent. The agent reads that node and its subtree
without the user selecting layers, switching pages, or pressing Sync.

The link must identify the file connected to the plugin, not the original file
from which a copy was made. The plugin must remain open for live reads. If it is
closed, return explicitly stale cached data only when requested, or an actionable
error. Never silently return data from a different file or call the REST API.

One-time setup may require the bridge connection token and the current file URL:
development plugins cannot assume `figma.fileKey` is available. Explain this in
the UI, save safe connection preferences, and show the connected file clearly.
Do not silently associate another document with the last URL entered.

## 2. Baseline and existing work to preserve

- `plugin/code.js`: current-page Watch, serialization, 800 ms debounce, upload
  queue, visible failures, mixed-property protection, escaped inline script.
- `plugin/manifest.json`: valid `{ "separator": true }` menu item.
- `plugin/code.test.js`: plugin runtime and generated UI tests.
- HTTP and MCP servers currently duplicate storage and compete for port 3456.
- Current MCP `sync_figma_design` uses the REST API, not the plugin.
- Existing README/docs changes are intentional and uncommitted. Preserve them
  while updating descriptions to match the new implementation.
- Baseline: 19 automated tests pass. No actual Figma acceptance for the new
  request-driven flow has yet been performed.

## 3. Architecture

```text
Claude / Codex / another MCP client (one stdio adapter per client)
                         |
                 shared local HTTP bridge
                 /                   \
        file/node cache          request broker
                                      |
                           Figma plugin UI transport
                                      |
                       Plugin API: getNodeByIdAsync
```

### Shared bridge and startup

- One loopback-only HTTP daemon owns sessions, the request queue and persistent
  cache. MCP processes are thin clients, not independent HTTP servers/stores.
- Keep `npm start` for explicit startup. Prefer automatic reuse/start from MCP
  for convenience; verify service identity and protocol version before reuse.
  Concurrent MCP starts must converge on one daemon. Never kill an unknown
  process or assume any listener on port 3456 is this bridge.
- Hidden Windows background startup only. No secrets or logs on MCP stdout.
- Respect the existing port/data-directory configuration consistently.
- Existing REST import remains explicit and optional; it is not a fallback for
  an offline plugin. Preserve legacy HTTP endpoints and migration of old cache
  where safe, but unkeyed legacy data cannot satisfy a file-specific URL read.

### Transport, identity and authentication

- Use dependency-light HTTP long-polling between the plugin UI and bridge, with
  heartbeat, reconnect/backoff, Stop, and cancellation/expiry. WebSocket is not
  needed for this first implementation.
- Authenticate new session, poll, reply, invalidation and design-read endpoints
  with a random local bridge token. Store it only in ignored local data; provide
  a deliberate local setup command/UI to reveal it for pairing. Never expose it
  in public health responses, docs examples, snapshots, or ordinary logs.
- Session registration includes the confirmed file key, file name and plugin
  instance identity. Session credentials and request IDs must be checked before
  accepting a result; one session cannot answer another file's request.
- Do not expose mutation endpoints without authentication just because the
  service uses localhost. Limit request sizes, validate schemas/URL schemes,
  reject unsafe Host headers, and configure CORS intentionally for Figma.
- Read-only operations only: no arbitrary code execution tool and no edits to
  the Figma design for pairing or reading.

### Cache and freshness

- Key entries by validated file key + canonical node ID + representation/options.
  Use safe filenames/encoding, atomic writes and bounded retention.
- Keep file/page/node caches separate. Reading node B cannot erase node A or
  cause another MCP client to switch files unexpectedly.
- Include fileKey, nodeId, pageId, source, fetchedAt, cache/live status, stale and
  truncation/completeness metadata in responses.
- Default URL reads refresh through the live plugin (or use cache only when its
  freshness is positively established). Explicit cached/offline reads must say
  whether freshness is unknown. TTL alone is not a guarantee of current content.
- Coalesce concurrent identical reads. Time out bounded requests, release all
  waiters, and ignore late/wrong-session replies. Session loss/restart must not
  leave unresolved requests or mark old cache as verified fresh.
- Plugin change notifications invalidate affected cache; conservative file-wide
  invalidation is acceptable initially. Guard against changes during a read.

### Agent interface

- `get_design_context({ source, ... })`: primary tool taking the pasted URL.
  Resolve file/node, request the plugin and return useful structured design data.
- `get_bridge_status`: connected files, readiness and actionable setup errors;
  never connection secrets.
- File URL without node-id returns a lightweight page/frame index, not an
  unexpectedly huge full-document dump. Agent follows node links as needed.
- Keep existing analysis tools, but support explicit source/context so concurrent
  agents never depend on a global mutable current selection.
- Optional bounded PNG preview via `get_design_screenshot({ source, ... })` is
  phase 3. If not implemented, document that structured data is not a screenshot.
- Enforce output/depth/node/byte limits with explicit partial/truncated markers.
  Provide a way to request a child subtree rather than silently claiming a large
  response contains the whole design.

### Plugin experience

- A clear Start/Stop connection panel with server URL, pairing settings, file
  identity, connection/error status and last requested node/time.
- No initial whole-file upload required. On request, resolve the node by ID and
  serialize its subtree, loading the relevant page as needed. Do not modify
  `currentPage` or selection to read a node on another page.
- Fetch a lightweight document index for file links.
- Keep manual page/selection commands as optional legacy helpers; request-driven
  reads are the default recommended workflow.
- Handle mixed Figma values, deleted/missing nodes and unsupported nodes safely.
- If adopting `documentAccess: dynamic-page`, migrate synchronous component
  access and subscriptions correctly; documentchange needs loadAllPagesAsync,
  or use compatible page-scoped events. Do not blindly add the manifest field.
- Manifest network permissions must cover the actual development loopback URL;
  re-import/restart instructions must state when the manifest changed.

## 4. Delivery checkpoints (Claude writes; Codex reviews)

### P1 — shared service, broker and cache

- [ ] Shared file/node cache with strict identity and freshness metadata.
- [ ] Authenticated session/heartbeat/poll/reply/read routes and bounded broker.
- [ ] Shared loopback HTTP daemon and reusable client/startup logic.
- [ ] Tests for file isolation, concurrency, timeout, late/wrong replies,
      disconnect, invalidation, malformed/oversized input and persistence.
- [ ] Stop for reviewer checkpoint; summarize the concrete route contract.

### P2 — plugin and MCP end-to-end

- [ ] Plugin Start/Stop, pairing, request polling, reconnect and cross-page reads.
- [ ] Thin MCP adapter, context/status tools and source-scoped analysis.
- [ ] Tests exercising actual HTTP and MCP stdio with a simulated plugin.
- [ ] No REST request or token needed on the plugin-first route.
- [ ] Review fixes and rerun baseline regression tests.

### P3 — user experience and release acceptance

- [ ] Bounded screenshot support if practical; otherwise record as deferred.
- [ ] README, API docs and short Vietnamese setup/troubleshooting guide.
- [ ] Manual Figma test: paste links for two nodes on different pages, with
      neither selected; edit/re-read, close plugin, reopen, and test wrong file.
- [ ] Independent review of authorization, cache freshness, multi-client use,
      output limits and setup steps. Fix material findings before sign-off.

P1/P2 are required for the promised link-driven workflow. Automated validation
does not replace real Figma validation; record pending user tests explicitly.

## 5. Acceptance cases

1. Node URL from the connected copy returns the exact requested node + children.
2. A second page's node is read without user selection or page navigation.
3. Missing/deleted node, wrong file, plugin offline and timeout are distinguishable.
4. Two MCP clients share one service and do not mix results, keys or request IDs.
5. A file URL returns an index; huge subtrees yield bounded, explicit partial data.
6. Live reads after editing do not silently return stale cache; offline reads
   require opt-in and disclose their freshness.
7. Restart persistence works, without advertising old cache as live/verified.
8. No Figma REST request occurs unless its dedicated import tool is requested.
9. No design data or pairing secret is sent to arbitrary hosts or logged publicly.
10. Existing import/serializer tests remain valid or are replaced with equivalent
    behavioral coverage where the interface intentionally changed.

## 6. Worker rules

- Claude is the implementation worker. Codex owns this plan, reviews diffs, runs
  independent checks and requests fixes. Do not mark reviewer/user acceptance
  complete yourself.
- Work only in this repository. Preserve pre-existing modifications and ignored
  real design data. Tests use isolated temporary data and non-production ports.
- Use `apply_patch` for edits. No destructive shell operations, git reset,
  checkout/discard, commit, push, new dependencies, or changes to user settings.
- Do not kill/restart the existing bridge on port 3456. The reviewer handles
  migration after tests pass and verifies the process identity first.
- No arbitrary code-run MCP capability; do not open public tunnels or change
  firewall rules. Ask for a decision if a genuinely new authority is required.
- Report touched files, test commands/results and limitations honestly. Keep
  the handoff concise. Do not modify this plan's reviewer acceptance status.

## References

- [Figma dynamic loading and async node APIs](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/)
- [Figma fileKey availability](https://developers.figma.com/docs/plugins/api/figma/)
- [Figma events and subscription constraints](https://developers.figma.com/docs/plugins/api/properties/figma-on/)
- [Figma plugin manifest](https://developers.figma.com/docs/plugins/manifest/)

## Review log

- 2026-09-17: plan created before implementation. Existing plugin-first goals and
  baseline changes recorded. Claude CLI found and authenticated. P1 pending.
