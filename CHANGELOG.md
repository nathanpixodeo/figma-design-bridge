# Changelog

All notable changes to Figma Design Bridge. Versions follow
[Semantic Versioning](https://semver.org/); the Claude Code plugin, the
marketplace entry and both `package.json` files always carry the same number.

## [1.10.1] - 2026-11-03

A read that Figma does not finish no longer blocks the plugin.

### Fixed

- A read stops a little before its `timeoutMs` and answers with what it read,
  rather than wait for a Figma call that does not finish. Before, an export
  inside a very large section could hold the plugin for minutes. Every read
  after it timed out until the panel was reopened. The answer is truncated,
  with `completeness.stoppedBy: "time"`, and `timing.stalled` names the Figma
  call and the layer. The note tells the agent to read one screen frame instead.
- A layer that does not load in time, and an `assets` or `render` export that
  does not finish, fail with an error that says so instead of a `TIMEOUT`. A
  read that waited past its deadline is refused at once.
- A read cut by its time limit is not cached and is not reused for a retry.
  Derived tools (`get_design_texts`, `search_design` and the others) no longer
  read such a node again at the bridge's caps.
- The `TIMEOUT` hint says to reopen the panel when even a small read times out.
- `timing` adds `outlineMs` and `variablesMs`.

## [1.10.0] - 2026-11-03

The panel gets a Tools menu, and its first tool finds layers in the open file.

### Added

- A **Tools** button in the panel header opens a list of tools. A tool
  replaces the bridge view until **Back**, and the bridge stays connected
  meanwhile.
- **Find node** finds layers by name, text content, type or component. It
  searches all pages (current page first) or this page only. A node id
  (`10996:249363`, `10996-249363`, `I1:3;3:9`) or a link with `node-id` finds
  that one layer. Clicking a match selects it and zooms to it. **Copy** copies
  a link to the layer for `get_design_context`.

## [1.9.0] - 2026-11-03

The Figma plugin panel only does what agents need: pair once, then stay
connected. It follows Figma's light or dark theme and asks for something only
when it needs it.

### Upgrading

- Import `plugin/manifest.json` again (**Plugins → Development → Import plugin
  from manifest…**) to drop the old menu. Until then, every entry of the old
  menu opens the panel.

### Changed

- The plugin has no menu: **Plugins → Development → Design Bridge** opens the
  panel directly.
- The panel is redesigned with Figma's theme colors and type, and its window
  fits its content. One status says what it is doing: Not paired, Pairing…,
  Connecting…, Connected, Waiting for bridge, Disconnected, Token rejected or
  File link needed.
- While it waits for the bridge, **Retry now** tries at once. **Connect** shows
  only after **Disconnect**.
- A token pasted under **Advanced**, or a file link pasted when Figma does not
  give the plugin one, connects at once, without a Connect click.
- The bridge's setup hints and the `/figma-bridge:pair`, `/figma-bridge:page`
  and `/figma-bridge:sync` commands name the new menu path, and point to live
  reads instead of the removed sync buttons.

### Removed

- **Sync page**, **Sync selection**, **Auto-sync page changes**, and the menu's
  **Quick Sync → Sync Full Page / Sync Selected Nodes**. Agents read nodes live
  through the panel. `POST /design` stays for `figma-bridge import`, and
  `sync_figma_design` still pulls a file through the REST API.
- The **Bridge URL** field. The manifest lets the plugin reach
  `http://localhost:3456` only, so another value could never connect; a saved
  one is dropped.

## [1.8.0] - 2026-10-27

One command sets approvals in every AI client on the machine, and Gemini CLI
joins the clients setup knows.

### Upgrading

- Run `figma-bridge update`, then `figma-bridge approvals auto` once on each
  machine, or `/figma-bridge:approvals auto` in each Claude Code profile. Design
  reads then run without a prompt even where the plugin's hook does not.

### Added

- `/figma-bridge:approvals [auto|manual]` in Claude Code shows or sets the
  approvals mode, like `figma-bridge approvals`. Only you can run it: Claude
  cannot call it to grant itself permissions.
- `figma-bridge approvals auto` adds rules for the ten read tools to
  `permissions.allow` in the Claude Code profile's `settings.json`
  (`CLAUDE_CONFIG_DIR`, or `~/.claude`), and `manual` takes them out again.
  Rules of your own and the file's line endings stay as they were. Setup does
  the same.
- Gemini CLI: `figma-bridge setup` registers the `figma-bridge` MCP server in
  `~/.gemini/settings.json`, keeping the environment of a server that is
  already there, and writes `~/.gemini/policies/figma-bridge.toml`. In `auto`
  the policy allows the read tools; pairing and REST sync always ask. `--only
  gemini` sets up Gemini CLI alone, and `GEMINI_CLI_HOME` is respected.

### Changed

- `figma-bridge approvals` accepts the mode in any case (`Auto`), and for a
  client the bridge is not set up in, still sets the mode and names the
  `figma-bridge setup --only <client>` to run.

## [1.7.0] - 2026-10-27

Full-screen and full-bleed backgrounds are built as the design draws them.

### Upgrading

- Close Design Bridge in Figma and open it again to load the new plugin. An
  older plugin still answers, without the places and fill stacks below.

### Added

- `get_design_assets` gives each layer that shows an image the CSS background
  that draws it there, at any size of the layer: FILL as cover, FIT as contain,
  CROP as the size and position of the part the designer framed, TILE at its
  scale. A layer whose fills stack a solid, the image and a gradient gets one
  declaration for all of them, top first, with blend modes; linear, radial and
  angular gradients are converted, and what CSS cannot draw, such as a diamond
  gradient, image filters or a turned image, is named with a render to compare.
- Each image layer has its place from the top left of the node read. A screen
  (a frame on a page or in a section) and a layer as large as the node read are
  named as a full-bleed background, and a layer as wide as the node as a
  full-bleed band, so a section of several screens still names each screen's
  background.
- Icons and images left out at `maxBytes` are read again, up to 10 of them,
  each by its own layer, so a large page sends every file it can.

### Fixed

- `get_design_context` kept the crop, tile scale, rotation and filters of an
  image fill only on layers small enough to export whole. A full-screen frame,
  read layer by layer, lost them, and its background image read as one that
  fills the frame.

## [1.6.0] - 2026-10-26

Icons, images and a rendered view come from the design itself.

### Upgrading

- Close Design Bridge in Figma and open it again to load the new plugin. Until
  then, `get_design_assets` and `get_design_image` answer `PLUGIN_OUTDATED`.
- Close every agent session once, so the bridge restarts on the new version. An
  older bridge cannot export assets, and the tools say so.

### Added

- `get_design_assets` exports every icon inside a node as Figma's own SVG, the
  markup Copy as SVG gives, with its exact size, colors, strokes and clipping.
  An icon is a layer drawn only with vector shapes; a chip or button with a fill
  of its own gives the glyph inside it. The same icon used by several layers is
  listed once with each of them. Every image fill comes as its original file,
  with the size, scale mode, crop and corner radius of each layer that shows it.
  Files are saved under `<dataDir>/assets/<fileKey>/`.
- `get_design_image` renders a node as PNG, JPG or SVG and shows it to the
  agent, so it can compare the page it built with the design. A PNG too large
  to show is rendered again as JPG, then smaller. Files are saved under
  `<dataDir>/renders/<fileKey>/`.
- Bridge representations `assets` and `render`, and plugin capabilities of the
  same names. A live read of either from an older plugin is refused with
  `409 PLUGIN_OUTDATED`, and a file link with `400 BAD_REQUEST`.
- `/figma-bridge:verify` and the Codex prompt compare icons and images against
  the exported assets, and layout against the render.

### Changed

- `get_design_context`'s `geometry` option says to export icons with
  `get_design_assets` instead of rebuilding them from paths, which leave out
  the transforms, strokes and clipping of the layers above them.

## [1.5.1] - 2026-10-26

A read covers the whole design: no layer is cut without its id.

### Upgrading

- Close Design Bridge in Figma and open it again to load the new plugin. A panel
  opened before the upgrade still reads at most 30 levels and drops byte-cut
  layers without naming them.

### Fixed

- Text, colors and layers nested deep inside component instances were left out.
  `depth` defaulted to 12 and the plugin read at most 30 levels. `depth` now
  defaults to 50, the most the bridge accepts, so every level is read unless a
  smaller depth is asked for.
- `get_design_summary`, `get_design_tree`, `get_design_texts`,
  `get_design_colors`, `search_design` and `get_design_info` cut a large frame
  at 2 MB, although their answer is far smaller than the read. When their first
  read is cut, they read the node again with `maxNodes: 20000` and
  `maxBytes: 10000000`, unless the caller set a limit.
- A read over `maxBytes` dropped its trailing layers, and a read past
  `maxNodes` stopped at the first layer that did not fit, without naming what
  was left. Each cut layer now stays in its parent as
  `{ id, name, type, truncated: true }`.

### Changed

- The truncation note names up to 15 cut layers as `"name" (id)` and says to
  read each one with the same link and its id as `node-id`, or to raise
  `maxBytes`.
- The summary, tree, text, color and search tools ask Claude Code to show up to
  500,000 characters inline, as `get_design_context` already did, so a long
  text table is not cut by the client.

## [1.5.0] - 2026-10-22

A live read returns every attribute Figma stores, and agents reading the same
file wait on each other far less.

### Upgrading

- Close every Claude Code, Codex and agy session, so the next one starts the
  new bridge: every session shares the bridge the first one started. Until
  then the MCP tools say the bridge is older than the MCP server.
- Close Design Bridge in Figma and open it again to load the new plugin. A panel
  opened before the upgrade keeps reading the old way, and every answer it gives
  carries `pluginOutdated: true` with a note saying to reopen it.

### Added

- A live read of a node returns Figma's REST API JSON for it, exported inside
  Figma with `exportAsync({ format: 'JSON_REST_V1' })`. It needs no REST token,
  API quota or Dev Mode seat. Values the plugin's own reading dropped come
  through: per-corner radii (`rectangleCornerRadii`), mixed text styles
  (`characterStyleOverrides`, `styleOverrideTable`), constraints, sizing,
  per-side strokes, bound variables and style ids. The payload is
  `{ document, components, componentSets, styles, variables }`, and `variables`
  names every bound variable with its collection, type and code syntax.
- A subtree too large for one export, or deeper than the read allows, becomes
  an outline marked `partial: true`, and its children are exported one by one.
  The read limits and the memory bound of 1.3.2 still hold. An export that fails
  after another one worked leaves an outline with `exportError`. When the first
  export fails, the plugin reads the old way and says why in `fallbackReason`.
  Every read reports its `timing`.
- An unchanged read is reused. A read of a node the same panel read in the last
  five minutes is answered from the cache once the panel confirms no edit since
  (`reused: true`, `ageMs`). The panel answers that check at once, even in the
  middle of another read. `fresh: true` reads again.
- `get_design_context` takes `fresh` and `geometry` (vector paths, as REST's
  `geometry=paths`). The other tools that take a `source` take `fresh`.
- Protocol: the `figma-rest` and `edit-seq` capabilities, the `edit-seq` op,
  the `fresh` field of `POST /bridge/read`, and the reply fields `format`,
  `editSeq`, `timing` and `fallbackReason`. See
  [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md).

### Changed

- The MCP tools ask for the REST JSON. `get_design_summary`, `get_design_tree`,
  `get_design_texts`, `get_design_colors`, `search_design` and
  `get_design_info` read it through the normalizer REST sync uses.
  `get_design_context` returns it as the plugin sent it, with notes inside the
  JSON on reuse, partial layers, a fallback or an outdated plugin.
- A text's `fontName.style` is Figma's style name (`Semi Bold Italic`) instead
  of the PostScript name when Figma gives one, in REST sync too.
- `TIMEOUT` counts the reads that were ahead in the queue, and says a retry is
  safe.

### Fixed

- Per-corner radii were lost: the plugin wrote `cornerRadius` only when the
  four corners matched. The plugin's own reading, used by Quick Sync and the
  Sync buttons, now writes `rectangleCornerRadii` when they differ.
- Reads of one file waited on each other longer than needed. A read whose caller
  had timed out was still walked, and one that timed out during its walk was
  walked again on retry. The panel now skips a read nobody waits for, the
  bridge keeps a late answer for the retry unless the cache holds a newer one,
  and identical reads waiting together share one answer.

## [1.4.1] - 2026-10-22

### Fixed

- **Pair with bridge** against a bridge older than 1.2.0 reported `Missing or
  invalid bridge token`, as if the token were the problem. Those bridges cannot
  pair at all, so the panel now says the bridge is too old and how to update
  it.

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

[1.10.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/f95d3f1...main
[1.10.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/711d037...f95d3f1
[1.9.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/48d758e...711d037
[1.8.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/c1f0d9e...48d758e
[1.7.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/d0e2682...c1f0d9e
[1.6.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/df30224...d0e2682
[1.5.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/334a489...df30224
[1.5.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/fab0416...334a489
[1.4.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/1559101...fab0416
[1.4.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/7b63529...1559101
[1.3.2]: https://github.com/nathanpixodeo/figma-design-bridge/compare/b093ebf...7b63529
[1.3.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/a392ce3...b093ebf
[1.3.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/398c555...a392ce3
[1.2.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6ed2cf9...398c555
[1.1.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/7a52eb4...6ed2cf9
[1.1.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6d344cf...7a52eb4
[1.0.2]: https://github.com/nathanpixodeo/figma-design-bridge/compare/0d37f46...6d344cf
[1.0.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/d5bd4be...0d37f46
[1.0.0]: https://github.com/nathanpixodeo/figma-design-bridge/commit/d5bd4be
