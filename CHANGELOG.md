# Changelog

All notable changes to Figma Design Bridge. Versions follow
[Semantic Versioning](https://semver.org/); the Claude Code plugin, the
marketplace entry and both `package.json` files always carry the same number.

## [1.3.1] - 2026-10-06

### Security

- Patched the vulnerable transitive dependencies the MCP SDK pulls in
  (`proxy-addr`, `fast-uri`, `ip-address`, `qs`, `hono`, `@hono/node-server`,
  `body-parser`); `npm audit` reports none. The bridge only uses the SDK's stdio
  transport, so these HTTP components were never reachable, but installs no
  longer ship the vulnerable versions.

### Added

- `timeoutMs` on `get_design_context` and the other live-read tools (1000 to
  120000 ms, default 30000), for the first read of a large page, which Figma
  loads slowly. A `TIMEOUT` error now says what to try next.
- `engines.node` (`>=20`) in both `package.json` files, matching what CI tests.

### Fixed

- The MCP server reports its real version to the client instead of `1.0.0`.

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

[1.3.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/a392ce3...main
[1.3.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/398c555...a392ce3
[1.2.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6ed2cf9...398c555
[1.1.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/7a52eb4...6ed2cf9
[1.1.0]: https://github.com/nathanpixodeo/figma-design-bridge/compare/6d344cf...7a52eb4
[1.0.2]: https://github.com/nathanpixodeo/figma-design-bridge/compare/0d37f46...6d344cf
[1.0.1]: https://github.com/nathanpixodeo/figma-design-bridge/compare/d5bd4be...0d37f46
[1.0.0]: https://github.com/nathanpixodeo/figma-design-bridge/commit/d5bd4be
