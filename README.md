# 🎨 Figma Design Bridge

[![CI](https://github.com/nathanpixodeo/figma-design-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/nathanpixodeo/figma-design-bridge/actions/workflows/ci.yml)

**Let AI coding assistants read Figma designs from a local cache.**

Figma Design Bridge normalizes design data into an agent-friendly local snapshot
and exposes it through both HTTP and MCP. There are two independent ways to get
design data in, and you only need one of them:

| | **Plugin path** | **REST path** |
|---|---|---|
| How data arrives | The Figma plugin pushes the current page or selection | The server pulls a Figma URL through the official REST API |
| Figma access token | **Not needed** | Required (`file_content:read`) |
| Needs plugin install | Yes, as a local development plugin | No |
| Reaches | The document you have open | Any file the token can read |
| Rate limits | None | Figma's API limits apply |

Both write to the same cache, so every MCP tool and HTTP route behaves
identically afterwards. Pick the plugin path if you can install a local plugin
in Figma; pick the REST path if you cannot, or if you want to pull files you do
not have open.

Neither path needs a Figma token to *read* the cache, but both need the local
**bridge token** to talk to the HTTP server — see
[Pair with the bridge token](#3-pair-with-the-bridge-token). The two tokens are
unrelated: the Figma one authenticates you to Figma, the bridge one keeps other
programs on your machine out of your design data.

A third, request-driven path is being built alongside them: a plugin-first
bridge where you paste any node URL and the agent reads that node live from the
open Figma document, with no REST token and no manual Sync click. It is wired up
but not yet proven end to end in Figma, so it is not a supported path yet — see
[Request-Driven Plugin Bridge](#request-driven-plugin-bridge-phase-1).

---

## Architecture

```text
   Plugin path (no Figma token)    REST path (Figma token required)
   ────────────────────────────    ────────────────────────────────
   Figma plugin, open document     Figma URL + personal access token
              │                                  │
              │ POST /design                     ▼
              │                        Official Figma REST API
              │                                  │
              └───────────────┬──────────────────┘
                              ▼
                  Normalize and cache locally
                   (latest.json + snapshots)
                              │
                      ┌───────┴────────┐
                      ▼                ▼
                  MCP tools        HTTP API
                      │                │
                      └───────┬────────┘
                              ▼
                    Claude Code / AI agents
```

### How It Works

**Plugin path.** `plugin/code.js` serializes the current page or selection and
posts it to `POST /design` on the local server. No Figma credential is involved:
the plugin already runs inside the document you have open.

**REST path.** `server/figma-api.js` parses a Figma URL and requests either the
full file or the `node-id` embedded in it, using `FIGMA_ACCESS_TOKEN`.

**Both paths converge.** The incoming design is normalized into one compact
schema — dimensions, text, colors, effects, auto-layout, components and child
nodes — then saved to `server/data/latest.json` plus timestamped snapshots.
Agents query the cached data; reading and searching never call Figma again.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for the local server)
- A Figma account that can view the target file

**For the REST path only**, also: a Figma personal access token with
`file_content:read` scope. See Figma's
[authentication guide](https://developers.figma.com/docs/rest-api/authentication/)
to create one. Starter accounts are subject to Figma's API limits, so the bridge
caches every successful import.

**The plugin path needs no Figma token.** If you are using the plugin, skip the
Figma token step below and go to
[Figma Plugin](#figma-plugin-token-free-path). You will still pair the plugin
with the bridge token in [step 3](#3-pair-with-the-bridge-token).

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd figma-bridge
```

Install the MCP SDK dependency:

```bash
npm install
```

### 2. Start the Server

If you intend to use the REST path, set the Figma token in the shell that starts
the bridge. Never commit it to the repository. Skip this if you are using the
plugin — the server starts and accepts plugin syncs without a Figma credential.

```powershell
$env:FIGMA_ACCESS_TOKEN="figd_your_token"
```

Then start the HTTP server:

```bash
node server/index.js
```

You'll see:
```
  🎨 Design Bridge Server running on http://localhost:3456
  ─────────────────────────────────────────────
  Config loaded from server/config.json
  Import with: npm run import:figma -- <figma-url>
```

To customize settings, edit `server/config.json` before starting:
```json
{
  "port": 3456,
  "dataDir": "data",
  "maxSnapshots": 50,
  "logLevel": "info"
}
```

Every setting also has an environment variable: `FIGMA_BRIDGE_PORT`,
`FIGMA_BRIDGE_DATA_DIR`, `FIGMA_BRIDGE_MAX_SNAPSHOTS`, `FIGMA_BRIDGE_LOG_LEVEL`.

```bash
FIGMA_BRIDGE_PORT=4567 node server/index.js
```

**The server binds `127.0.0.1` only.** `FIGMA_BRIDGE_HOST` overrides that for
cases that genuinely need it, such as a container that has to be reachable from
its host — the server logs a warning at startup whenever the bind address is not
loopback. Do not set it on a shared network.

Prefer an address over a name. `FIGMA_BRIDGE_HOST=localhost` binds whichever
loopback family the name resolves to first, which on some systems is `::1`
alone — and then nothing answers on `http://127.0.0.1:3456`, including the
plugin.

A loopback port is not a private port, though: a browser runs on the same
machine, so a page you have open can issue requests to `127.0.0.1`. Three
controls apply to every route, and all three are on by default — see
[SECURITY.md](SECURITY.md) and
[docs/SERVER_API.md](docs/SERVER_API.md#access-control).

1. The listener binds loopback.
2. A request whose `Host` header names anything but a loopback host gets `403`,
   which defeats DNS rebinding. A cross-origin `Origin` gets `403` too, and no
   response ever carries `Access-Control-Allow-Origin: *`.
3. Every route except `GET /` and `GET /health` requires the bridge token.

### 3. Pair with the Bridge Token

Everything that reads or writes design data needs a local token. The server
creates one on first start and keeps it in `<dataDir>/bridge-token.json`. Print
it with:

```bash
npm run bridge:token
```

Send it as `Authorization: Bearer <token>` or `X-Bridge-Token: <token>`. To
revoke it and unpair every client, run `npm run bridge:token:rotate`.

Every shell example in this README assumes `$BRIDGE_TOKEN`, so export it once:

```bash
export BRIDGE_TOKEN="$(npm run --silent bridge:token)"
```

`npm run import:figma` finds the token by itself, from `FIGMA_BRIDGE_TOKEN` if
that is set and otherwise from the data directory.

The Figma plugin has a **Bridge token** field in its panel: paste the value
there once and it is remembered per Figma user, so subsequent syncs authenticate
themselves.

> **Breaking change in 1.1.0.** `/design`, `/snapshots` and the rest used to
> answer without a token. Scripts written against 1.0.x get `401` until they
> send one. `FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1` restores the old behaviour
> for scripts that cannot be updated yet; the server then warns at every startup
> and **any web page open on your machine can read, overwrite or delete the
> cached design**. The `Host` and `Origin` checks still apply.

### 4a. Sync from the plugin (no Figma token)

Install `plugin/` as a local development plugin (see
[Figma Plugin](#figma-plugin-token-free-path)), open the file you want, paste the
bridge token into the plugin's **Bridge token** field, then run
**Plugins → Development → Design Bridge → Sync Full Page**. The plugin posts the
page straight to the running server.

### 4b. Import a Design from Chrome (REST path, Figma token required)

Copy the design URL from Chrome. If the URL contains `node-id`, only that node is imported; otherwise the full file is imported.

```powershell
npm run import:figma -- "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"
```

Alternatively, ask the running HTTP server to fetch it:

```bash
curl -X POST http://localhost:3456/figma/import \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"}'
```

### 5. Query the Cached Design

Once the design is synced, point Claude CLI to the server:

```bash
# Get a markdown summary of the entire design
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/summary

# ASCII tree of the layer hierarchy
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/tree

# All text content extracted from the design
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/texts

# Color palette analysis
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/colors

# Search nodes by name or text content
curl -H "Authorization: Bearer $BRIDGE_TOKEN" "http://localhost:3456/design/search?q=button"

# Full JSON design tree
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design
```

---

## Server API Reference

Every example below assumes `$BRIDGE_TOKEN` holds the bridge token, as in
[step 3](#3-pair-with-the-bridge-token). `GET /` and `GET /health` are the only
routes that answer without it; everything else returns `401`.

### `GET /health`

Returns server status and available endpoints.

```bash
curl http://localhost:3456/health
```

```json
{
  "status": "ok",
  "port": 3456,
  "hasDesign": true,
  "pageName": "Page 1",
  "nodeCount": 142,
  "endpoints": [
    "GET     /",
    "POST   /figma/import",
    "POST   /design",
    "DELETE /design",
    "GET    /design",
    "GET    /design/summary",
    "GET    /design/tree",
    "GET    /design/texts",
    "GET    /design/colors",
    "GET    /design/search?q=",
    "GET    /snapshots",
    "GET    /snapshots/:filename",
    "GET    /health"
  ]
}
```

### `POST /design`

Receive already-normalized design data. This is the endpoint the Figma plugin posts to, and it is also used by the CLI importer. It requires no Figma access token — the bridge token is what it checks.

The server validates incoming data and returns proper error codes:
- `400` — invalid or missing fields
- `401` — missing or wrong bridge token
- `413` — payload exceeds maximum size

```bash
curl -X POST http://localhost:3456/design \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageName":"Page 1","nodes":[...],"nodeCount":142}'
```

### `POST /figma/import`

Fetch a Figma URL or file key through the official REST API, normalize it, cache it, and make it the current design. The server process must have `FIGMA_ACCESS_TOKEN` set.

```bash
curl -X POST http://localhost:3456/figma/import \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://www.figma.com/design/FILE_KEY/Design","nodeIds":["1:2"]}'
```

`nodeIds` is optional. A `node-id` in the URL is used automatically when `nodeIds` is omitted.

### `GET /design`

Returns the full design JSON — the complete serialized node tree.

### `GET /design/summary`

Returns a **Markdown summary** of the design, including:
- Overview and page metadata
- Screen/frame list with dimensions and auto-layout info
- Full ASCII layer tree
- All text content in a table (path, font, size)
- Color palette with usage frequency
- Structural statistics (component count, instance count, etc.)

This is the most useful endpoint for Claude CLI.

### `GET /design/tree`

Returns a plain-text ASCII tree of the layer hierarchy:

```
Page 1
└── FRAME "Home Screen" [375×812]
    ├── RECTANGLE "Background" [375×812] #FFFFFF
    ├── TEXT "Title" [300×40] "Welcome to the App"
    ├── FRAME "Header" [375×60] [HORIZONTAL]
    │   ├── TEXT "Logo" [60×20] "LOGO"
    │   └── FRAME "Nav" [200×36] [HORIZONTAL]
    │       ├── TEXT "About" [60×20] "About"
    │       └── TEXT "Contact" [60×20] "Contact"
    └── FRAME "Card Grid" [375×auto] [VERTICAL]
        ├── FRAME "Card 1" [160×200]
        │   ├── RECTANGLE "Image" [160×140] #E5E5E5
        │   ├── TEXT "Card Title" [140×20] "Getting Started"
        │   └── TEXT "Card Desc" [140×30] "Learn how to..."
        └── FRAME "Card 2" [160×200]
            ...
```

### `GET /design/texts`

Extracts every text node in the design:

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/texts
```

```json
{
  "texts": [
    {
      "path": "Page 1 > Home Screen > Title",
      "id": "1234:5678",
      "name": "Title",
      "characters": "Welcome to the App",
      "fontSize": 24,
      "fontFamily": "Inter",
      "fontStyle": "Bold",
      "color": "#1C1C1E"
    }
  ]
}
```

### `GET /design/colors`

Returns all unique colors used in fills and strokes, grouped by color, with usage locations:

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/colors
```

```json
{
  "colors": {
    "#1C1C1E": [{"node": "Title", "prop": "fill"}],
    "#007AFF": [{"node": "Button", "prop": "fill"}]
  }
}
```

### `GET /design/search?q=<query>`

Search nodes by name or text content (case-insensitive):

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" "http://localhost:3456/design/search?q=button"
```

```json
{
  "query": "button",
  "results": [
    {
      "id": "1234:5678",
      "name": "Primary Button",
      "type": "FRAME",
      "path": "Page 1 > Home > Primary Button",
      "width": 200,
      "height": 48,
      "x": 88,
      "y": 500
    }
  ]
}
```

### `DELETE /design`

Clears the current design from the server memory.

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" -X DELETE http://localhost:3456/design
```

```json
{ "status": "ok", "message": "Design cleared" }
```

### `GET /snapshots`

Lists all saved design snapshots on disk.

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/snapshots
```

```json
{
  "snapshots": [
    {
      "filename": "2026-06-15T10-30-00.000Z.json",
      "size": 28416,
      "pageName": "Page 1",
      "nodeCount": 142,
      "syncedAt": "2026-06-15T10:30:00.000Z",
      "savedAt": "2026-06-15T10:30:00.123Z"
    }
  ]
}
```

Newest first. A snapshot whose contents cannot be read still appears, with an
`error` field explaining why instead of missing metadata. Full field reference:
[docs/SERVER_API.md](docs/SERVER_API.md#get-snapshots).

### `GET /snapshots/:filename`

Loads a specific snapshot into memory, replacing the current design.

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/snapshots/design-2026-06-15T10-30-00.json
```

---

## Server Features

### Persistence

Design snapshots are automatically saved to `server/data/snapshots/` after each sync. On restart, the server loads the latest snapshot from disk, so your design survives server restarts. The server keeps a maximum of 50 snapshots, pruning the oldest automatically.

### Graceful Shutdown

The server handles SIGINT and SIGTERM signals, saving the current design to disk before shutting down.

### Logging

All requests and events are logged with structured output including timestamps and severity levels (`info`, `warn`, `error`). The log level is configurable via the `logLevel` setting in `server/config.json`.

### Error Handling

The server validates all incoming request payloads and returns appropriate HTTP status codes:
- `400` — invalid or malformed request body
- `404` — resource not found (snapshot, endpoint)
- `413` — payload exceeds size limit
- `500` — internal server error

---

## Request-Driven Plugin Bridge (Phase 1)

> **Status: phase 1 complete, phase 2 in progress.** The modules under
> `server/bridge/` are covered by tests and the HTTP server mounts them under
> `/bridge/`, and the Figma plugin now opens a session and answers polls. What is
> still missing is the manual Figma acceptance run described under
> [Known gaps](#known-gaps-before-this-works-end-to-end), so treat this path as
> unproven end to end and keep using the two paths above for real work.

The REST import path above works, but it has a shape problem: it needs a personal
access token, it caches one global "current design" that every sync replaces, and
it cannot read a node the user has not explicitly imported. The request-driven
bridge is the answer to that.

The target workflow: open the Figma file, start the plugin, paste any node URL
into your agent — and the agent reads that node out of the live document. No REST
token, no selecting layers, no switching pages, no Sync button.

```text
MCP client (Claude Code, Codex, …)      Figma plugin UI
            │                                  │
            │  POST /bridge/read               │  poll / reply (long-poll)
            ▼                                  ▼
            shared loopback bridge daemon
              ├── request broker   (routes a read to the session owning that file)
              └── content cache    (file key + node id + representation)
```

What phase 1 delivers:

| Module | Responsibility |
|--------|----------------|
| `server/bridge/identity.js` | Parse Figma URLs, canonicalize node ids, derive safe cache keys |
| `server/bridge/cache.js` | Content-addressed cache with atomic writes and bounded retention |
| `server/bridge/broker.js` | Session registry, bounded request queue, timeouts, coalescing |
| `server/bridge/token.js` | Local bridge token: create, read, rotate, verify |
| `server/bridge/routes.js` | The `/bridge/*` HTTP surface |
| `server/bridge/daemon.js` | Loopback daemon with safe start-or-reuse |
| `server/bridge/client.js` | Thin client for MCP adapters |

Design rules it enforces:

- **A live read is live or it is an error.** No cache fallback, no REST fallback.
  With the plugin offline, a live read returns `409 NO_SESSION_FOR_FILE` and
  says what to do, rather than quietly handing back older data.
- **Freshness is asserted, never inferred.** `verifiedFresh: true` is written
  only when a live plugin reply produced the entry. A cached read always reports
  `freshness: "unknown"` and `stale: true`, however recently it was written.
  A TTL is not a freshness guarantee.
- **Files are isolated.** Entries are keyed by file key + node id +
  representation. Reading node B never evicts node A, and one plugin session can
  never answer, poll or invalidate another file's request.
- **Authentication is not optional on localhost.** Every route but
  `GET /bridge/health` requires a bearer token; session routes require a second
  per-session secret. Requests are Host-checked against loopback to block DNS
  rebinding, and CORS is an explicit origin allowlist, never `*`.
- **Limits are explicit.** Truncation is reported as
  `completeness: { nodeCount, byteSize, limitHit, truncatedNodeIds }`, so a
  bounded response never claims to be the whole design.

The token lives in `<dataDir>/bridge-token.json`, which `.gitignore` excludes. It
is never included in a health response, a session listing, a snapshot or a log
line.

Full route contract, request/response schemas and error codes:
**[docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md)**.
Phase breakdown and acceptance cases:
[docs/PLAN_PLUGIN_ON_DEMAND_MCP.md](docs/PLAN_PLUGIN_ON_DEMAND_MCP.md).

### Running the tests

```bash
npm test
```

This runs the whole suite — the bridge modules, the legacy access-control tests,
the plugin serializer and the REST importer. No network and no Figma credential
are involved; every test uses a temporary data directory and a free port. CI runs
the same command on Linux and Windows against Node 20, 22 and 24.

### Known gaps before this works end to end

- No manual Figma acceptance run has been performed against the new `/bridge/*`
  routes yet. The plugin still targets `POST /design`.

---

## Figma Plugin (Token-Free Path)

The Figma plugin in `plugin/` is a fully supported way to get design data in,
and the only one that needs no Figma access token: it runs inside the document
you already have open and posts to your local bridge directly. Install it as a
local development plugin via **Plugins → Development → Import plugin from
manifest…**, pointing at `plugin/manifest.json`.

It still needs the local bridge token. Paste the output of
`npm run bridge:token` into the panel's **Bridge token** field; the plugin stores
it per Figma user, so this is a one-time step per machine.

### Network access

`plugin/manifest.json` declares:

```json
"networkAccess": {
  "allowedDomains": ["none"],
  "devAllowedDomains": ["http://localhost:3456"]
}
```

The plugin contacts no external service, so production access is `none` and the
loopback origin is declared under `devAllowedDomains`, which Figma honours for a
plugin imported from a manifest. **This hard-codes port 3456.** If you move the
bridge with `FIGMA_BRIDGE_PORT`, change `SERVER_URL` in `plugin/code.js` and the
`devAllowedDomains` entry to match, then re-import the plugin — otherwise Figma
blocks the request.

Changing the manifest requires **Plugins → Development → Import plugin from
manifest…** again for the change to take effect.

Use the REST path instead if you cannot install local plugins, or if you need to
read a file you do not have open. The two paths write to the same cache and are
never both required.

### Menu Commands

| Command | Action |
|---------|--------|
| **Sync Full Page** | Serializes the whole current page, including descendants, regardless of the current selection |
| **Sync Selected Nodes** | Serializes selected nodes and their descendants; requires a non-empty selection |
| **Watch Mode (Auto-Sync)** | Syncs the whole current page on opening, then automatically after design edits or page switches. Includes Sync Now and an Auto-sync toggle. |

### Watch Mode

Watch Mode sends every frame and nested layer on the **current page**; you do not need to select or click each node. It sends an initial snapshot as soon as its panel opens, then watches document edits and page switches. Selecting a different layer does not shrink the synced data to that selection.

- Start the local bridge server, open the editable Figma copy on the page you want, then run **Plugins → Development → Design Bridge → Watch Mode (Auto-Sync)**. Keep the panel open.
- **Auto-sync toggle** — pauses future automatic updates (an upload already in progress may finish). Re-enabling sends a fresh page snapshot.
- **Sync Now button** — manually sends the whole current page, even when auto-sync is disabled.
- **Debounce and queue** — edits/page switches are debounced for 800 ms. Only one upload runs at a time; changes during an upload are coalesced into a fresh snapshot afterward.
- **Status** — the panel shows the last successfully synced page, recursive node count, and sync time. HTTP/network errors are shown; a stalled upload times out after 30 seconds. Use **Sync Now** to retry.

This is **current-page sync, not whole-file sync**. Moving to another page replaces the server's current design; previous snapshots remain subject to the server's retention limit. Closing the plugin stops live updates, but cached data remains readable. A Figma URL alone does not yet make this plugin open another file or fetch an unsynced node. This plugin path posts directly to your local bridge and does not invoke Figma's REST import endpoint.

The plugin uses Figma's [`documentchange` and `currentpagechange` events](https://developers.figma.com/docs/plugins/api/properties/figma-on/) with the existing legacy document-access manifest. If migrating the manifest to `dynamic-page`, load pages before subscribing to `documentchange` or migrate to page-scoped events. Very large pages may exceed the standalone server's 50 MB request limit; use **Sync Selected Nodes** on a containing frame/section in that case (its descendants are included).

The plugin menu now includes a **Sync Design** submenu with **Full Page** and **Selected Nodes**, a separator, then **Watch Mode (Auto-Sync)**.

### What Gets Serialized

The plugin captures a rich set of properties for each node:

| Property | Included |
|----------|----------|
| Identity | `id`, `name`, `type` |
| Geometry | `x`, `y`, `width`, `height`, `rotation`, `opacity` |
| Visibility | `visible`, `locked`, `clipsContent` |
| Corner radius | `cornerRadius` |
| **Text** | `characters`, `fontSize`, `fontName`, `textAlignHorizontal`, `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `paragraphSpacing` |
| **Fills** | SOLID (`color` hex, `opacity`), GRADIENT (stops with positions), IMAGE (`imageHash`, `scaleMode`) |
| **Strokes** | Same as fills + `strokeWeight`, `strokeAlign`, `dashPattern` |
| **Effects** | Drop shadow, inner shadow, blur (`type`, `radius`, `offset`, `color`) |
| **Auto Layout** | `layoutMode`, `padding*`, `itemSpacing`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap` |
| **Layout** | `layoutGrow`, `layoutAlign`, `layoutPositioning` |
| **Components** | `componentPropertyDefinitions`, `componentProperties`, `componentRef` |
| **Sections** | `sectionContentsHidden`, `expanded` |

### Depth Limit

The serializer caps recursion at 30 levels of nesting to prevent stack overflows on very deep trees. Deeper nodes are marked `{ truncated: true }`.

---

## MCP (Model Context Protocol) Support

Figma Design Bridge includes a built-in MCP server (`server/mcp.mjs`) that adds native support for Claude Code and any MCP-compatible client. Instead of writing `curl` commands, you configure the MCP server once and then Claude can read your design directly.

### Setup

```bash
# Install dependencies (MCP SDK)
npm install
```

### Install as a Claude Code plugin (recommended)

The repository is also a Claude Code plugin marketplace. Installing it registers the MCP server and three slash commands in one step, for every project on the machine:

```bash
claude plugin marketplace add nathanpixodeo/figma-design-bridge
claude plugin install figma-bridge@figma-design-bridge
```

| Command | Does |
| --- | --- |
| `/figma-bridge:verify <node-url> <paths...>` | Compares front-end code against the design and reports every mismatch |
| `/figma-bridge:page [summary\|tree\|texts\|colors]` | Shows what is currently in the cache, and how stale it is |
| `/figma-bridge:sync <figma-url>` | Pulls a file or node through the REST API (needs a Figma token) |

The plugin resolves its own paths through `${CLAUDE_PLUGIN_ROOT}`, so nothing breaks when the clone moves, and it caches designs in `${CLAUDE_PLUGIN_DATA}`, which survives plugin updates.

That data directory is the one thing worth understanding before you sync. The MCP server also tries to listen on port 3456, and when it succeeds it is itself the endpoint the Figma plugin posts to — install, sync from Figma, done. But if a standalone `node server/index.js` already holds 3456, that process receives the sync and writes it to *its* data directory, and the plugin's tools will correctly report that nothing is loaded. Either let the plugin's MCP server own the port, or start the standalone server against the same directory:

```bash
# print the directory the plugin's MCP server is reading
# (also shown by /figma-bridge:page)
FIGMA_BRIDGE_DATA_DIR="<that path>" node server/index.js
```

The bridge token lives in that same directory, so the token the Figma plugin has
to be paired with is the one belonging to whichever process owns port 3456:

```bash
FIGMA_BRIDGE_DATA_DIR="<that path>" npm run bridge:token
```

For Codex CLI, see [`integrations/codex/README.md`](integrations/codex/README.md).

### Configure in Claude Code manually

If you would rather not install the plugin, add to your `claude.json` or MCP config:

```json
{
  "mcpServers": {
    "figma-design-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/figma-design-bridge/server/mcp.mjs"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "${FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}
```

`FIGMA_ACCESS_TOKEN` is only read by the `sync_figma_design` tool. Omit the
whole `env` block if you feed the bridge from the plugin — every other tool
reads the local cache and needs no credential.

The MCP server communicates with Claude Code via stdio and also tries to start a
local HTTP endpoint on port 3456 for plugin syncs. If another process already
holds that port — typically `node server/index.js` — the MCP server logs the
clash, skips the listener and keeps serving over stdio, reading snapshots from
the same data directory. Running both is therefore safe. Restart the MCP client
after changing its environment configuration.

> **Note:** Use the absolute path to `server/mcp.mjs` in your MCP config.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_design_context` | Read a Figma file or exact node through the connected plugin (`source` required; live by default) |
| `get_bridge_status` | Show bridge readiness, live plugin sessions, cache statistics, and setup hints |
| `sync_figma_design` | Explicitly fetch a Figma URL/file key, normalize it, and cache it locally |
| `get_design_summary` | Full markdown summary for an explicit `source` or the legacy snapshot |
| `get_design_tree` | ASCII tree for an explicit `source` or the legacy snapshot |
| `get_design_texts` | Text content for an explicit `source` or the legacy snapshot |
| `get_design_colors` | Color palette for an explicit `source` or the legacy snapshot |
| `search_design` | Search an explicit `source` or the legacy snapshot by node name/text (`q` required) |
| `get_design_info` | Basic info for an explicit `source` or the legacy snapshot |

### Usage Flow with MCP

For a live plugin read, no Figma REST token is needed:

1. Start Claude Code; it auto-starts the MCP server.
2. Ask: *"Read this Figma design: https://www.figma.com/design/..."*
3. The agent calls `get_bridge_status`, then `get_design_context` with the
   exact URL as `source`; use the same `source` for searches and extracted
   text or colors.

For the explicit REST-import flow, export `FIGMA_ACCESS_TOKEN` before starting
Claude Code and ask: *"Sync this Figma design: https://www.figma.com/design/..."*
1. `sync_figma_design` for the explicit import.
2. The legacy snapshot tools after import, for example:
   - *"What's in the current Figma design?"*
   - *"Extract all the text content and rewrite the hero section copy"*
   - *"Search for all button components in the design"*
   - *"Analyze the color palette and suggest an accessible alternative"*

Design data persists to disk, so it survives between Claude Code sessions. Read/search tools use the cache and do not consume Figma API requests. Call `sync_figma_design` only when the design changes.

## Example: Using with Claude CLI (HTTP API)

If you prefer the HTTP API instead of MCP:

```bash
# Start the HTTP server
npm start

# In another terminal, query the design
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/summary | \
  claude -p "Analyze this Figma design and suggest improvements"
```

Or search for specific elements:

```bash
TEXTS=$(curl -s -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/design/texts)
claude -p "Based on these text nodes, write better copy for the landing page: $TEXTS"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| HTTP `401` from `/design` or `/snapshots` | Send the bridge token: `npm run bridge:token`, then `-H "Authorization: Bearer <token>"`. In the Figma plugin, paste it into the **Bridge token** field. |
| HTTP `403` "addressed to a loopback host" | Reach the server as `localhost` or `127.0.0.1`, not through another host name or a reverse proxy that rewrites `Host`. |
| HTTP `403` "origin is not allowed" | The request came from a web page on a real origin. Only the Figma plugin iframe (`Origin: null`) and loopback origins are allowed. |
| `Missing FIGMA_ACCESS_TOKEN` | Export the token before starting the HTTP/MCP process, then restart it. |
| Figma API `403` | Verify `file_content:read` scope and that the token owner can view the file. |
| Figma API `429` | Wait for the reported retry period; use cached design tools instead of repeatedly syncing. |
| Import command cannot connect | Start `npm start` or the MCP server first; override with `FIGMA_BRIDGE_URL` if using a custom port. |
| Server port conflict | Set a custom port: `FIGMA_BRIDGE_PORT=4567 node server/index.js` |
| Design seems incomplete | Import the full-file URL without `node-id`, or pass the required `nodeIds` explicitly. |
| MCP server not connecting | Make sure `npm install` was run. Use absolute path to `server/mcp.mjs` in config. |
| MCP tools return "No design data" | Call `sync_figma_design` with a Figma URL first. |

---

## Project Structure

```
figma-bridge/
├── plugin/
│   ├── manifest.json          # Figma plugin manifest (declares networkAccess)
│   └── code.js                # Plugin sandbox code — POSTs the page to /design
├── server/
│   ├── data/                  # latest.json + snapshots + bridge-token.json (gitignored)
│   ├── config.json            # Auto-created config (port, dataDir, maxSnapshots, logLevel)
│   ├── figma-api.js           # Figma REST client + schema normalizer
│   ├── figma-api.test.js      # Normalizer/import tests
│   ├── import-figma.mjs       # CLI importer
│   ├── bridge-token.js        # Prints/rotates the bridge token
│   ├── data-dir.js            # Read-only data-directory resolution
│   ├── package.json           # Server metadata
│   ├── index.js               # HTTP server
│   ├── legacy-auth.test.js    # Access control on the snapshot routes
│   ├── mcp.mjs                # MCP server (requires @modelcontextprotocol/sdk)
│   └── bridge/                # Request-driven plugin bridge (phase 1, not yet wired in)
│       ├── identity.js        # Figma URL/node-id parsing and cache keys
│       ├── cache.js           # Content-addressed cache, atomic writes
│       ├── broker.js          # Session registry, request queue, timeouts
│       ├── token.js           # Local bridge token
│       ├── routes.js          # /bridge/* HTTP surface
│       ├── daemon.js          # Loopback daemon, safe start-or-reuse
│       ├── client.js          # Thin client for MCP adapters
│       ├── e2e.test.js        # End-to-end tests over real HTTP
│       └── *.test.js          # Unit tests for each module
├── docs/
│   ├── SERVER_API.md          # REST/snapshot server API
│   ├── BRIDGE_PROTOCOL.md     # /bridge/* route contract
│   └── PLAN_PLUGIN_ON_DEMAND_MCP.md  # Implementation plan and acceptance cases
├── .github/workflows/ci.yml   # Tests on Linux + Windows, Node 20/22/24
├── SECURITY.md                # Threat model and how to report a vulnerability
├── README.md
├── LICENSE
└── .gitignore
```

---

## Security

The bridge holds a copy of whatever design was last synced, which can include
unreleased work. [SECURITY.md](SECURITY.md) describes the threat model — the
network, the browser and the token — and how to report a vulnerability
privately. Please do not open a public issue for anything exploitable.

---

## Buy Me a Beer 🍺

This bridge is free and runs entirely on your own machine — no account, no telemetry, no hosted service to pay for. If it saved you an afternoon of copying values out of Figma by hand, a beer is a fine way to say so.

[![Buy me a beer via PayPal](https://img.shields.io/badge/PayPal-Buy%20me%20a%20beer-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/shivakira95)

Stars, bug reports, and pull requests are just as welcome.

---

## License

[Apache License 2.0](LICENSE) © 2026 Nathan Pixodeo
