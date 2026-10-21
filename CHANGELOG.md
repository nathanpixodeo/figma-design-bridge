# Changelog

All notable changes to Figma Design Bridge. Versions follow
[Semantic Versioning](https://semver.org/); the Claude Code plugin, the
marketplace entry and both `package.json` files always carry the same number.

## [1.4.0] - 2026-10-21

One command installs everything, a `figma-bridge` command works from any
directory, and design reads stop asking for permission.

### Upgrading

- Run `npx -y @pixodeo/figma-bridge@latest setup` once. It installs the
  `figma-bridge` command and updates the plugin in Claude Code and Codex. A
  Claude Code or Codex marketplace you added from GitHub stays in use.
- Figma keeps loading the plugin from the manifest you imported, which a clone
  updates with `git pull`. To have `figma-bridge update` update it instead,
  remove the development plugin in Figma and import the `manifest.json` path
  setup prints.
- Codex set up by hand before 1.4.0 (`codex mcp add figma-bridge …`) would run
  the bridge twice. Setup says so; remove it with `codex mcp remove figma-bridge`.
- Settings move to `config.json` in the data directory. `server/config.json` in
  a clone is still read, never written; the file in the data directory wins.

### Added

- The `@pixodeo/figma-bridge` npm package and its `figma-bridge` command:
  `setup`, `status`, `approvals`, `update`, `start`, `mcp`, `pair`, `token` and
  `import`, from any directory. The `npm start` and `npm run bridge:*` scripts
  keep working in a clone.
- `figma-bridge setup` installs the plugin into Claude Code and Codex from the
  package's own marketplace, registers the MCP server with agy, creates the
  pairing token and prints the Figma manifest path. Clients that are not on
  `PATH` are skipped; `--only` picks some. Running it again updates, and keeps
  a plugin you turned off turned off and the environment of agy's server. The
  first time it changes a client's config file, it keeps a copy ending in
  `.figma-bridge.bak`.
- `figma-bridge status` shows the version, the data directory and where it came
  from, whether a token exists (never the token), who holds the port and which
  Figma files are connected, and each client.
- Approvals, `auto` by default: Claude Code, Codex and agy run the eight read
  tools without a prompt. Pairing and REST sync always ask.
  `figma-bridge approvals manual` makes every tool ask again. The MCP tools now
  carry `readOnlyHint`, `destructiveHint` and `openWorldHint` annotations, and
  the Claude Code plugin ships a `PreToolUse` hook for the read tools.
- CI checks what `npm pack` would publish and runs the packed command; a
  manual release workflow publishes to npm.

### Changed

- The server no longer creates `server/config.json`, so it runs from a
  read-only install.
- Messages, the Figma panel and the docs name `figma-bridge` commands instead of
  `npm run` scripts.
- `@modelcontextprotocol/sdk` 1.32.1 or later, which fixes the advisories
  against 1.31.0 and earlier. The bridge uses only the stdio transport, which
  they do not affect.

## [1.3.2] - 2026-10-19

Keeps a large live read from freezing Figma or losing the panel. Nothing to
migrate; reopen Design Bridge in Figma to load the new plugin code.

### Fixed

- A large read no longer freezes Figma. The plugin walked the node in one go,
  at roughly 270–600 nodes a second, so Figma and the panel stopped responding
  until it finished. A read over 90 s starved the heartbeats and the session
  expired with `SESSION_LOST`. The walk now hands control back to Figma every
  50 ms, and the panel serves one read at a time.
- An edit made during a read is reported after that read's reply, so it also
  drops the entry the reply cached, which may mix content from before and after
  the edit.
- A read holds less memory once the walk ends. The plugin serializes the
  result once, frees the walked tree before it parses the text back, and reuses
  the byte count instead of serializing again to measure it.
- When the panel stops answering while it has a read (Figma closes the plugin
  with `Plugin runtime aborted` when a read runs it out of memory), the read
  fails with a `SESSION_LOST` that says so, and the MCP tools add what to do:
  reopen Design Bridge, then read one screen frame, a smaller `depth` or
  `maxNodes`, or `includeHidden: false`.

### Changed

- `maxNodes` is capped at 20,000 (was 200,000) and `maxBytes` at 10,000,000
  (was 50,000,000). The bridge rejects a larger value with `BAD_REQUEST`, and
  the MCP tool schemas advertise the new maxima. The defaults stay at 5,000
  nodes and 2,000,000 bytes. A plugin reply body may now be 11,000,000 bytes.
- The tool descriptions, `/figma-bridge:verify` and the Codex prompt ask for a
  link to one screen frame rather than a section of many screens, and for
  `includeHidden: false` unless hidden layers matter.

## [1.3.1] - 2026-10-06

A production-hardening release: no new workflow, many fixes found by a full
audit. Nothing to migrate.

### Security

- `npm start` could be stopped by any web page: an `<img>` pointing at
  `http://127.0.0.1:3456//[` sent a URL the parser rejects, and the exception
  ended the process. Such a request now gets `400`, and any handler error is a
  `500` for that request alone.
- `npm run bridge:token:rotate` now revokes the old token at once. A running
  bridge used to keep accepting it until it restarted.
- `GET /` and `GET /health` send no CORS header, so a web page can no longer
  read the page name and the data directory path (which includes the OS user
  name) through a sandboxed iframe.
- The data and snapshot directories are created owner-only (`0700`).
- Patched the vulnerable transitive dependencies the MCP SDK pulls in
  (`proxy-addr`, `fast-uri`, `ip-address`, `qs`, `hono`, `@hono/node-server`,
  `body-parser`); `npm audit` reports none. The bridge only uses the SDK's stdio
  transport, so these were never reachable, but installs no longer ship them.

### Fixed

- Typing in Figma no longer stalls the bridge. Every edit made the bridge read
  and parse its whole cache, which took seconds per keystroke with a large one.
  The cache now keeps an in-process index and never parses entries for
  bookkeeping (60 entries of 3 MB: 3.1 s to 0.2 ms per invalidation), and the
  panel sends at most one invalidation at a time plus one follow-up a second
  later.
- A reopened panel works at once. Reads went to the oldest live session for a
  file, so a session left behind by a crashed or closed panel took every read
  for up to 90 s and each one timed out. They now go to the session heard from
  most recently, and the panel closes its session with a `keepalive` request.
- A read handed to a poll whose plugin hung up is given back to the queue
  instead of being lost until it times out.
- `get_design_texts`, `get_design_colors` and `search_design` refuse a file
  link, which only reaches the document index, instead of answering that the
  design has no text or colors. Every derived answer names its source and says
  when the read was truncated. The `/figma-bridge:verify` and Codex prompts ask
  for a node link.
- An MCP server that could not start the bridge — its port held by an older
  version, say — keeps trying in the background, so it takes the port over
  within about 10 s of it freeing up instead of at the next tool call.
- A health check that times out is reported as `BRIDGE_BUSY`, not as a foreign
  program on the port.
- Two launchers creating the first token at the same moment end up with the
  same one.
- `npm start` on a port a bridge already holds no longer crashes with
  `EADDRINUSE`. It exits `0` when that bridge shares its data directory, and
  `1` with the reason when it does not (another data directory, or a version
  older than 1.3.0, would keep the Figma plugin on a different token). Ctrl+C no
  longer waits for the plugin's long-poll, and `/bridge/../health` is answered
  instead of hanging.
- A late failure or success from a session the panel already replaced no longer
  ends the new session or starts a second heartbeat chain.
- One cache entry that cannot be read or stat-ed (held by a scanner on Windows)
  no longer disables the cache.
- `npm run import:figma` uses `FIGMA_BRIDGE_PORT` and the configured port.
- The MCP server reports its real version to the client instead of `1.0.0`.

### Added

- `timeoutMs` on `get_design_context` and the other live-read tools (1000 to
  120000 ms, default 30000), for the first read of a large page, which Figma
  loads slowly. A `TIMEOUT` from a read says what to try next.
- A 200 MB budget for the live-read cache next to its 500-entry cap:
  `FIGMA_BRIDGE_CACHE_MAX_BYTES`, or `cacheMaxBytes` in `server/config.json`.
  It must be a whole number of bytes; anything else (`200MB`, `0`) is ignored
  with a warning.
- `engines.node` (`>=20`) in both `package.json` files, matching what CI tests.

### Changed

- Moving to the shared data directory no longer copies the old cache; it
  refills from live reads. The token, the current design and the ten newest
  snapshots are still copied.

## [1.3.0] - 2026-10-05

### Changed

- One data directory per user, shared by every launcher — Claude Code in any
  profile, Codex, `npm start` and the npm scripts:
  `%LOCALAPPDATA%\figma-design-bridge` on Windows,
  `~/Library/Application Support/figma-design-bridge` on macOS and
  `~/.local/share/figma-design-bridge` on Linux. They share one token, so the
  Figma plugin pairs once per machine.
- On the first start, the token, the current design, the cache and the ten
  newest snapshots are copied from the directory the previous version used. A
  `dataDir` or `FIGMA_BRIDGE_DATA_DIR` naming `server/data` counts as unset.
- The Figma panel says **Waiting for the bridge...** instead of
  "Failed to fetch" while nothing runs, and connects by itself once something
  does. When the bridge refuses the saved token it says **Pairing needed** and
  offers **Pair with bridge**. A failed Sync tells a missing bridge apart from
  an upload that was too large.

### Upgrade notes

- Update the plugin in every Claude Code profile you use, then restart Claude
  Code. A bridge older than 1.3.0 that still holds port 3456 keeps its own
  token and rejects the shared one with `401`.
- Remove any `FIGMA_BRIDGE_DATA_DIR` you set for 1.2 to align launchers, unless
  it names `server/data`.

## [1.2.0] - 2026-10-01

### Added

- Pairing. **Pair with bridge** in the panel shows a 6-digit code; approving it
  with `/figma-bridge:pair <code>`, the `approve_figma_pairing` tool or
  `npm run bridge:pair -- <code>` hands the plugin the bridge token. Nobody
  copies the token by hand any more.
- One **Open Design Bridge** panel for pairing, live reads and syncing. Figma
  tells the plugin which file it is in (`enablePrivatePluginApi`), so no file
  link has to be pasted.

## [1.1.1] - 2026-10-01

### Fixed

- The Claude Code plugin's MCP server works end to end: the bridge it starts
  also serves the plugin's `/design` sync; a taken port or a bridge on another
  data directory is reported instead of crashing the server; snapshot tools see
  syncs written by other processes; another MCP server takes the port over when
  the owner exits; large nodes are trimmed to `maxBytes` instead of failing;
  an oversized reply fails one read instead of the whole session; reads with
  and without hidden layers are cached apart; design payloads are compact JSON.

## [1.1.0] - 2026-09-17

### Changed

- **Breaking:** `/design`, `/snapshots` and the other legacy routes require the
  bridge token. `FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1` restores the old
  behaviour and warns at every start.

## [1.0.2] - 2026-09-17

### Security

- The server binds the loopback interface instead of every interface.

## [1.0.1] - 2026-09-17

### Added

- The request-driven plugin bridge (`/bridge/*`) with its shared loopback
  daemon, request broker and content cache.
- The Claude Code plugin and a Codex integration; the plugin declares its MCP
  server inline so that it loads.
- `networkAccess` in the Figma plugin manifest.

## [1.0.0] - 2026-06-15

### Added

- REST import of Figma files and nodes, snapshot persistence, the Figma plugin
  with page and selection sync and Watch mode, and the MCP server for Claude
  Code.

[1.3.2]: https://github.com/nathanpixodeo/figma-design-bridge/compare/b093ebf...main
[1.3.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/a392ce3...b093ebf
[1.3.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/398c555...a392ce3
[1.2.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6ed2cf9...398c555
[1.1.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/7a52eb4...6ed2cf9
[1.1.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6d344cf...7a52eb4
[1.0.2]: https://github.com/nathanpixodeo/figma-design-bridge/compare/0d37f46...6d344cf
[1.0.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/d5bd4be...0d37f46
[1.0.0]: https://github.com/nathanpixodeo/figma-design-bridge/commit/d5bd4be
