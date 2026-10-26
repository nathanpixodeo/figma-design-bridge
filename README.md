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

A third, request-driven path is the one [Install](#install)
uses: a plugin-first bridge where you paste any node URL and the agent reads that
node live from the open Figma document, with no REST token and no manual Sync
click. See [Request-Driven Plugin Bridge](#request-driven-plugin-bridge-phase-1).

## Install

One command, on any machine with [Node.js](https://nodejs.org/) 20 or later:

```bash
npx -y @pixodeo/figma-bridge@latest setup
```

It installs the `figma-bridge` command globally, creates the pairing token, and
sets up every AI client it finds on `PATH`:

- **Claude Code**: installs the `figma-bridge` plugin, which carries the MCP
  server, the [slash commands](#install-as-a-claude-code-plugin-recommended) and
  the hook that lets design reads run without a prompt.
- **Codex**: installs the same plugin.
- **agy**: registers the `figma-bridge` MCP server and its approval rules.

A client that is not installed is skipped; run `figma-bridge setup` again after
installing it. Running setup again is always safe: it updates what is already
there. If the `figma-bridge` command is already installed,
`npm install -g @pixodeo/figma-bridge && figma-bridge setup` does the same.

Each Claude Code profile has its own plugins. If you use several
(`CLAUDE_CONFIG_DIR`), run `figma-bridge setup --only claude` once with each.

If npm cannot write its global folder (`EACCES` on Linux with a system-wide
Node.js), install Node.js through a version manager such as nvm, or set an npm
prefix your user owns. Do not run setup with `sudo`: it would set up the clients
of the root user.

### Connect Figma

Once per machine, in Figma desktop:

1. **Plugins → Development → Import plugin from manifest…**, and pick the
   `manifest.json` path that setup printed. `figma-bridge status` prints it again.
2. Open your file and run **Plugins → Development → Design Bridge → Open Design
   Bridge**.
3. Press **Pair with bridge**. The panel shows a 6-digit code. Approve it with
   `/figma-bridge:pair <code>` in Claude Code, or `figma-bridge pair <code>` in
   any terminal. The panel saves the token and connects.

From then on, opening the panel connects by itself, and you can paste any node
link of that file into your AI client. Figma tells the plugin which file it is
in, so no link has to be pasted into the panel; if your Figma account does not,
the panel asks for the file's link once per document.

The bridge runs while Claude Code, Codex or agy does; nothing has to be started
by hand. Opened before them, the panel shows **Waiting for the bridge...** and
connects as soon as a session starts. A plugin installed during a session starts
with the next one: restart Claude Code (`claude -c` resumes the conversation).
`figma-bridge start` runs the bridge on its own, without an AI client.

### Commands

`figma-bridge` works from any directory.

| Command | Does |
| --- | --- |
| `figma-bridge setup [--only claude,codex,agy] [--approvals auto\|manual]` | Sets up the AI clients and the pairing token. Safe to repeat |
| `figma-bridge status` | Shows the version, the data directory, whether the bridge runs and which Figma files are connected, and each client |
| `figma-bridge approvals [auto\|manual]` | Shows or sets whether design reads ask before they run. See [Approvals](#approvals) |
| `figma-bridge update` | Installs the latest version and runs setup again |
| `figma-bridge start` | Runs the bridge in this terminal |
| `figma-bridge mcp` | Runs the MCP server on stdio, for an MCP client configured by hand |
| `figma-bridge pair <code>` | Approves the Figma plugin that shows this code |
| `figma-bridge token [--rotate]` | Prints the bridge token for scripts, or replaces it and unpairs every plugin |
| `figma-bridge import <figma-url>` | Pulls a design through the Figma REST API (needs `FIGMA_ACCESS_TOKEN`) |

### Approvals

Reading a design changes nothing, so by default (`auto`) Claude Code, Codex and
agy run the eight read tools — `get_design_*`, `search_design` and
`get_bridge_status` — without asking. `approve_figma_pairing` hands a Figma
plugin the bridge token and `sync_figma_design` calls the Figma API, so those two
always ask. Rules of your own that deny or ask for a tool still apply.

```bash
figma-bridge approvals manual   # every bridge tool asks again
figma-bridge approvals auto     # back to the default
```

| Client | `auto` | `manual` |
| --- | --- | --- |
| Claude Code | The plugin's `PreToolUse` hook allows the read tools | The hook stays silent and Claude Code asks as usual |
| Codex | The tools are marked `readOnlyHint`, which Codex runs without asking | `default_tools_approval_mode = "prompt"` for the plugin's server in `config.toml` |
| agy | `mcp(figma-bridge/<tool>)` rules in `permissions.allow` of `~/.gemini/antigravity-cli/settings.json` | Those rules are removed |

The mode is stored as `approvals` in `config.json` in the
[data directory](#where-data-lives). Claude Code reads it at every tool call;
for Codex and agy the command rewrites their config file. The first time setup
changes one of those files, it keeps the file as it was next to it, with
`.figma-bridge.bak` added to the name.

### Update and uninstall

```bash
figma-bridge update
```

Then restart running Claude Code, Codex and agy sessions, and close and reopen
the Design Bridge panel in Figma. The manifest path stays the same, so Figma
needs no new import. [CHANGELOG.md](CHANGELOG.md) lists what changed.

On Windows, npm cannot replace files that a running program holds open. If the
update fails with `EPERM` or `EBUSY`, close Claude Code, Codex and agy, stop a
`figma-bridge start` that is running, and run `figma-bridge update` again.

Running setup again is also how an install repairs itself. It keeps what you
changed since: a plugin you turned off stays off, and agy keeps the environment
you gave its server, such as `FIGMA_ACCESS_TOKEN`. A marketplace whose folder
no longer exists, such as a deleted clone, is replaced with this install.

To uninstall, remove the plugin in Figma (**Plugins → Development → Manage
plugins in development**), then:

```bash
claude plugin uninstall figma-bridge@figma-design-bridge
claude plugin marketplace remove figma-design-bridge
codex plugin remove figma-bridge@figma-design-bridge
codex plugin marketplace remove figma-design-bridge
agy mcp remove figma-bridge
npm uninstall -g @pixodeo/figma-bridge
```

The [data directory](#where-data-lives) keeps the token and the cache; delete it
too to remove everything.

### From a clone

Contributors can run everything from a clone:

```bash
git clone https://github.com/nathanpixodeo/figma-design-bridge.git
cd figma-design-bridge
npm install
npm link             # puts this clone's figma-bridge on PATH
figma-bridge setup   # the clients then load the plugin from this clone
```

The `npm start` and `npm run bridge:*` scripts still work inside the clone.

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
nodes — then saved to `latest.json` in the [data directory](#where-data-lives)
plus timestamped snapshots.
Agents query the cached data; reading and searching never call Figma again.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (for the local server)
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

### 1. Install

Run the one command in [Install](#install). The steps below use the
`figma-bridge` command it puts on `PATH`.

### 2. Start the Server

If you intend to use the REST path, set the Figma token in the shell that starts
the bridge. Never commit it to the repository. Skip this if you are using the
plugin — the server starts and accepts plugin syncs without a Figma credential.

```powershell
$env:FIGMA_ACCESS_TOKEN="figd_your_token"
```

Then start the HTTP server:

```bash
figma-bridge start
```

You'll see:
```
  🎨 Design Bridge Server — http://localhost:3456
  ─────────────────────────────────────────────
  Import with: figma-bridge import <figma-url>
```

To customize settings, create `config.json` in the
[data directory](#where-data-lives) before starting:
```json
{
  "port": 3456,
  "maxSnapshots": 50,
  "logLevel": "info"
}
```

The bridge only reads this file, and never creates it. A clone also reads
`server/config.json`, as before 1.4.0; the file in the data directory wins where
both set a key.

Every setting also has an environment variable: `FIGMA_BRIDGE_PORT`,
`FIGMA_BRIDGE_DATA_DIR`, `FIGMA_BRIDGE_MAX_SNAPSHOTS`, `FIGMA_BRIDGE_LOG_LEVEL`.
`FIGMA_BRIDGE_CACHE_MAX_BYTES` (`cacheMaxBytes` in `config.json`) caps the
live-read cache, 200 MB by default; it holds at most 500 entries either way.

#### Where data lives

The bridge token, the snapshots and the cache live in one directory per user of
the machine:

| OS | Directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\figma-design-bridge` |
| macOS | `~/Library/Application Support/figma-design-bridge` |
| Linux | `~/.local/share/figma-design-bridge` |

On Linux the path comes from the home directory alone, not from
`XDG_DATA_HOME`: MCP hosts such as Codex pass a server only a few environment
variables, and every launcher has to arrive at the same directory.

Every launcher uses it: the Claude Code plugin in any profile, Codex, agy and
every `figma-bridge` command. They share one token, so the Figma plugin pairs
once per machine, whichever of them holds the port. Set `FIGMA_BRIDGE_DATA_DIR`
(or, in a clone, `dataDir` in `server/config.json`) only to keep a setup apart
on purpose; every process that should share it then needs the same value.
`figma-bridge status` shows the directory in use and where it came from.
Uninstalling leaves this directory in place; delete it to remove the token and
the cache.

**Upgrading from 1.2 or earlier.** On its first start, 1.3.x copies the token,
the current design and the ten newest snapshots from the directory the previous
version used — `server/data`, or the Claude Code plugin's own data directory —
and leaves that directory as it was, for launchers not updated yet. The cache is
not copied (1.3.0 did); it refills from live reads. A file that cannot be copied
is skipped and named in the log. A `dataDir` in
`server/config.json` or a `FIGMA_BRIDGE_DATA_DIR` that names `server/data` —
the default `npm start` used to write, and what the Codex guide used to
prescribe — counts as unset. Remove any other `FIGMA_BRIDGE_DATA_DIR` you set
for 1.2 to align launchers, such as `FIGMA_BRIDGE_DATA_DIR=<plugin data> npm start`,
or that launcher keeps a directory and token of its own.
`FIGMA_BRIDGE_MIGRATE_FROM` names another directory to copy from; the Claude
Code plugin sets it to its previous data directory.

```bash
FIGMA_BRIDGE_PORT=4567 figma-bridge start
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
3. Every route requires the bridge token except `GET /`, `GET /health`,
   `GET /bridge/health` and the two pairing routes (`POST /bridge/pair`,
   `GET /bridge/pair/:id`), which hand nothing out until someone holding the
   token approves the code. The open legacy routes send no CORS header, so a web
   page cannot read them.

### 3. Pair with the Bridge Token

Everything that reads or writes design data needs a local token. Setup, or the
first server start, creates one and keeps it in `<dataDir>/bridge-token.json`.

**The Figma plugin pairs by itself.** Press **Pair with bridge** in its panel and
approve the 6-digit code it shows, with `/figma-bridge:pair <code>` in Claude
Code or `figma-bridge pair <code>` in any terminal. The plugin then receives
the token and remembers it per Figma user. The code expires after two minutes,
and nothing is handed out until someone who already has the token approves it.

For scripts and `curl`, print the token with:

```bash
figma-bridge token
```

Send it as `Authorization: Bearer <token>` or `X-Bridge-Token: <token>`. To
revoke it and unpair every client, run `figma-bridge token --rotate`.

Every shell example in this README assumes `$BRIDGE_TOKEN`, so export it once:

```bash
export BRIDGE_TOKEN="$(figma-bridge token)"
```

`figma-bridge import` finds the token by itself, from `FIGMA_BRIDGE_TOKEN` if
that is set and otherwise from the data directory.

The plugin also has a **Bridge token** field under **Advanced**, if you prefer to
paste the value there yourself.

> **Breaking change in 1.1.0.** `/design`, `/snapshots` and the rest used to
> answer without a token. Scripts written against 1.0.x get `401` until they
> send one. `FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1` restores the old behaviour
> for scripts that cannot be updated yet; the server then warns at every startup
> and **any web page open on your machine can read, overwrite or delete the
> cached design**. The `Host` and `Origin` checks still apply.

### 4a. Sync from the plugin (no Figma token)

Import the Figma plugin as a local development plugin (see
[Connect Figma](#connect-figma)), open the file you want and run
**Plugins → Development → Design Bridge → Open Design Bridge**. Pair it once (see
step 3), then press **Sync page** or **Sync selection**; the panel posts straight
to the running server. **Quick Sync → Sync Full Page** does the same without
opening the panel, once the plugin is paired.

### 4b. Import a Design from Chrome (REST path, Figma token required)

Copy the design URL from Chrome. If the URL contains `node-id`, only that node is imported; otherwise the full file is imported.

```bash
figma-bridge import "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"
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
  "snapshotCount": 5,
  "dataDir": "/home/you/.local/share/figma-design-bridge",
  "endpoints": [
    "GET  /health",
    "POST /figma/import",
    "POST /design",
    "GET  /design",
    "DELETE /design",
    "GET  /design/summary",
    "GET  /design/tree",
    "GET  /design/texts",
    "GET  /design/colors",
    "GET  /design/search?q=",
    "GET  /snapshots",
    "GET  /snapshots/:filename"
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

Clears the current design from this server's memory until the next sync, from
any process, replaces it. Snapshots stay on disk, so a restart restores the
cleared design from `latest.json`. Other processes' memory is not affected.

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" -X DELETE http://localhost:3456/design
```

```json
{ "message": "Design data cleared from memory. Snapshots remain on disk." }
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

Returns one saved snapshot. The current design is not changed.

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" http://localhost:3456/snapshots/2026-06-15T10-30-00.000Z.json
```

---

## Server Features

### Persistence

Design snapshots are automatically saved to `snapshots/` in the [data directory](#where-data-lives) after each sync. On restart, the server loads the latest snapshot from disk, so your design survives server restarts. The server keeps a maximum of 50 snapshots, pruning the oldest automatically.

`latest.json` is shared: when another process — the MCP server or a second `figma-bridge start` on the same data directory — writes a newer one, the next read picks it up without a restart.

### Graceful Shutdown

Every sync is written to disk when it arrives, so nothing is lost on exit. SIGINT and SIGTERM close the listener, and the process is forced to exit after 5 seconds.

### Logging

All requests and events are logged with structured output including timestamps and severity levels (`info`, `warn`, `error`). The log level is configurable via the `logLevel` setting in `config.json`.

### Error Handling

The server validates all incoming request payloads and returns appropriate HTTP status codes:
- `400` — invalid or malformed request body
- `404` — resource not found (snapshot, endpoint)
- `413` — payload exceeds size limit
- `500` — internal server error

---

## Request-Driven Plugin Bridge (Phase 1)

> **Status: supported.** The modules under `server/bridge/` are covered by
> tests, both the HTTP server and the MCP server mount them under `/bridge/`, and
> the Figma plugin's **Open Design Bridge** panel pairs, opens a session and
> answers live reads. Pairing and live reads were accepted against a real Figma
> file on Windows; macOS and Linux run the automated suite. See
> [Known gaps](#known-gaps).

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

- **A live read is the plugin's answer or an error.** It is read now, or read
  earlier and confirmed unchanged by the plugin (`reused: true`). No cache
  fallback, no REST fallback. With the plugin offline, a live read returns
  `409 NO_SESSION_FOR_FILE` and says what to do, rather than quietly handing
  back older data.
- **Freshness is asserted, never inferred.** `verifiedFresh: true` is written
  only when a live plugin reply produced the entry. A cached read always reports
  `freshness: "unknown"` and `stale: true`, however recently it was written.
  A TTL is not a freshness guarantee.
- **Files are isolated.** Entries are keyed by file key + node id +
  representation. Reading node B never replaces node A's entry, and one plugin session can
  never answer, poll or invalidate another file's request.
- **Authentication is not optional on localhost.** Every route but
  `GET /bridge/health` and the pairing request and pickup requires a bearer
  token; session routes require a second per-session secret. Requests are Host-checked against loopback to block DNS
  rebinding, and CORS is an explicit origin allowlist, never `*`.
- **Limits are explicit.** Truncation is reported as
  `completeness: { nodeCount, byteSize, limitHit, truncatedNodeIds }`, so a
  bounded response never claims to be the whole design. `maxBytes` counts UTF-8
  bytes, and a cut keeps the subtree in document order up to the limit rather
  than collapsing it to the requested node. Every cut layer stays as a
  placeholder with its id, so it can be read on its own.

The token lives in `<dataDir>/bridge-token.json`, which `.gitignore` excludes. It
is never included in a health response, a session listing, a snapshot or a log
line.

### Reads from several agents

Every agent session shares one bridge, and every read of a file goes to the
Design Bridge panel open on that file. Figma runs a plugin on one thread, so the
panel reads one node at a time; reads of different files run in parallel. Since
1.5.0, agents reading the same file wait on each other far less:

- **One native export instead of a walk.** A node is read with Figma's own
  `exportAsync({ format: 'JSON_REST_V1' })` instead of property by property in
  JavaScript. Each read reports `timing: { countMs, exportMs, totalMs }`.
- **Unchanged reads are reused.** A read of a node the same panel read in the
  last five minutes is answered from the cache once the panel confirms no edit
  since (`reused: true`, with `ageMs` and the original `fetchedAt`). The panel
  answers that check at once, even in the middle of another read, so a reused
  read never waits in its queue. Pass `fresh: true` to read again.
- **No read is wasted.** A read whose caller timed out before its turn is
  skipped. One the panel was already working on is kept when it finishes, and
  answers the caller's retry. Identical reads waiting together share one answer.
- **A timeout says why.** `TIMEOUT` counts the reads that were ahead of it.

Full route contract, request/response schemas and error codes:
**[docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md)**.
Phase breakdown and acceptance cases:
[docs/PLAN_PLUGIN_ON_DEMAND_MCP.md](https://github.com/nathanpixodeo/figma-design-bridge/blob/main/docs/PLAN_PLUGIN_ON_DEMAND_MCP.md), in the repository.

### Running the tests

```bash
npm test
```

This runs the whole suite — the bridge modules, the legacy access-control tests,
the plugin serializer and the REST importer. No network and no Figma credential
are involved; every test uses a temporary data directory and a free port. CI runs
the same command on Linux and Windows against Node 20, 22 and 24.

### Known gaps

- Manual acceptance in a real Figma session has been run on Windows only. The
  panel's live reads use `/bridge/*`; its Sync buttons still post to
  `POST /design`.
- The first read of a large page can take longer than the default 30-second
  timeout while Figma loads it. Pass a larger `timeoutMs` (up to 120000), or a
  smaller `depth` or `maxNodes`; a retry is fast.
- A read is capped at 20,000 nodes and 10 MB. Figma can still close the plugin
  when a large read runs it out of memory; read one screen frame rather than a
  section of many screens.
- Figma does not report every edit to plugins, a change to a variable's value
  alone for one, so a read reused within five minutes of such a change can miss
  it. Pass `fresh: true` to read again.
- More in [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md#known-limitations).

---

## Figma Plugin (Token-Free Path)

The Figma plugin in `plugin/` is a fully supported way to get design data in,
and the only one that needs no Figma access token: it runs inside the document
you already have open and posts to your local bridge directly. Install it as a
local development plugin via **Plugins → Development → Import plugin from
manifest…**, pointing at the `plugin/manifest.json` path `figma-bridge status` prints.

It still needs the local bridge token. Press **Pair with bridge** and approve
the code, or paste the output of `figma-bridge token` into the panel's **Bridge
token** field under **Advanced**; the plugin stores it per Figma user, so this is
a one-time step per machine.

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

### The Panel

**Plugins → Development → Design Bridge → Open Design Bridge** opens one panel for everything:

- **Pair with bridge** (first time only) shows a 6-digit code. Approve it in Claude Code with `/figma-bridge:pair <code>`, or in a terminal with `figma-bridge pair <code>`. The plugin then saves the token per Figma user.
- **Connect / Disconnect.** Once paired, the panel connects by itself whenever it opens. While it is open, agents can read any node of this file by its link, on any page, without changing your selection. Keep the panel open.
- **Sync page / Sync selection** post the current page, or the selected nodes and their descendants, to the bridge's snapshot cache.
- **Auto-sync page changes** is off by default. When on, edits and page switches re-sync the current page, debounced for 800 ms. Only one upload runs at a time; changes made during an upload are coalesced into one fresh snapshot.
- **Advanced** holds the bridge URL, the bridge token (to paste it by hand) and, only when Figma does not tell the plugin which file it is in, the file's link, remembered per document.

The panel shows the file, the last node an agent read and the last sync. HTTP and network errors are shown, and a stalled upload times out after 30 seconds.

- **Waiting for the bridge...** Nothing answers at the bridge URL yet, because no AI client with the bridge, and no `figma-bridge start`, is running. This is not an error: the panel keeps trying every few seconds and connects as soon as one starts.
- **Pairing needed.** The bridge refused the saved token: it was rotated, or this bridge keeps its own data directory. The panel stops retrying and shows **Pair with bridge** again.

### Menu Commands

| Command | Action |
|---------|--------|
| **Open Design Bridge** | The panel above: pairing, live reads, sync buttons and auto-sync |
| **Quick Sync → Sync Full Page** | Serializes the whole current page, including descendants, regardless of the current selection, then closes |
| **Quick Sync → Sync Selected Nodes** | Serializes selected nodes and their descendants, then closes; requires a non-empty selection |

The Quick Sync commands use the token saved by pairing.

Syncing is **current-page sync, not whole-file sync**. Syncing another page replaces the server's current design; previous snapshots remain subject to the server's retention limit. Closing the panel stops live reads and auto-sync, but cached data remains readable. The sync path posts directly to your local bridge and never calls Figma's REST API.

The plugin uses Figma's [`documentchange` and `currentpagechange` events](https://developers.figma.com/docs/plugins/api/properties/figma-on/) with the legacy document-access manifest. If migrating the manifest to `dynamic-page`, load pages before subscribing to `documentchange` or migrate to page-scoped events. Very large pages may exceed the standalone server's 50 MB request limit; use **Sync selection** on a containing frame or section in that case (its descendants are included).

`plugin/manifest.json` sets `enablePrivatePluginApi`, which lets a development plugin read `figma.fileKey`, so the panel knows which file it is in. Changing the manifest requires **Plugins → Development → Import plugin from manifest…** again. A menu imported before 1.2.0 keeps working until then: **Connect On-Demand Bridge** opens the new panel, and **Watch Mode (Auto-Sync)** still opens the old watch panel.

### What Gets Serialized

**A live read of a node** (1.5.0 and later) returns Figma's REST API JSON for
it, the same as `GET /v1/files/:key/nodes?ids=:id`, exported inside Figma by
the plugin with `exportAsync({ format: 'JSON_REST_V1' })`. No REST token, API
quota or Dev Mode seat is involved. Every attribute comes through as Figma
stores it, for instance:

| Area | Fields |
|------|--------|
| Corners | `cornerRadius`, `rectangleCornerRadii` (one per corner), `cornerSmoothing` |
| Text | `characters`, `style`, `characterStyleOverrides`, `styleOverrideTable`, `lineTypes`, `lineIndentations` |
| Layout | `layoutMode`, padding, `itemSpacing`, `layoutSizingHorizontal`, `layoutSizingVertical`, `constraints`, min and max sizes, `layoutGrids` |
| Paint | `fills`, `strokes`, `strokeWeight`, `individualStrokeWeights`, `strokeDashes`, `effects`, `blendMode` |
| Tokens | `boundVariables`, `styles` |
| Components | `componentId`, `componentProperties`, `overrides` |

The payload is `{ document, components, componentSets, styles, variables }`.
`variables` names every variable the tree binds: `name`, `collection`,
`resolvedType` and `codeSyntax`. `geometry: true` adds vector paths
(`fillGeometry`, `strokeGeometry`), as REST's `geometry=paths` does.

The read limits still apply. `depth` defaults to 50, so every level of a design
is read unless a smaller depth is asked for. Figma exports a layer whole when its
subtree fits what is left of `maxNodes` and `depth`, up to 5,000 layers in one
export. A larger layer, and every page, is marked `partial: true`: its own box,
layout, paint and bound variables are read from the plugin API, and its children
are exported one by one. Text is cut at 100,000 characters
(`textTruncated: true`).

A limit never drops a layer silently. Layers below `depth`, the layers left once
`maxNodes` is spent and, when the payload is over `maxBytes`, its trailing
layers become `{ id, name, type, truncated: true }`. The answer's note names
them, and each one can be read with the same link and its id as `node-id`. REST
JSON is larger than the plugin's own reading, so a read fills `maxBytes` (2 MB
by default) sooner: read one screen frame, read the layers the note names, or
pass `includeHidden: false`.

The summary, tree, text, color, search and info tools return a small answer
derived from the read, so their `depth`, `maxNodes` and `maxBytes` bound the
plugin's read, not the answer. When their first read is cut, they read the node
again with `maxNodes: 20000` and `maxBytes: 10000000`, unless the caller set a
limit, and their note names whatever is still left out.

If the first export of a read fails, this Figma may not export JSON at all: the
plugin reads the node its own way and says why in `fallbackReason`. A later
export that fails leaves that layer as a `partial` outline, with the reason in
`exportError`. A panel older than 1.5.0 always reads its own way, and the answer
carries `pluginOutdated: true`: close Design Bridge and open it again to load
the new plugin.

**The plugin's own reading**, used by Quick Sync, the Sync buttons and the
fallback above, captures these properties:

| Property | Included |
|----------|----------|
| Identity | `id`, `name`, `type` |
| Geometry | `x`, `y`, `width`, `height`, `rotation`, `opacity` |
| Visibility | `visible`, `locked`, `clipsContent` |
| Corner radius | `cornerRadius`, or `rectangleCornerRadii` when the corners differ |
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

### Install as a Claude Code plugin (recommended)

`figma-bridge setup` installs the plugin (see [Install](#install)). The package
is also a Claude Code plugin marketplace, so the plugin registers the MCP server,
four slash commands and the [approvals](#approvals) hook in one step, for every
project on the machine. With access to the GitHub repository, Claude Code can
also install it from there:

```bash
claude plugin marketplace add nathanpixodeo/figma-design-bridge
claude plugin install figma-bridge@figma-design-bridge
```

| Command | Does |
| --- | --- |
| `/figma-bridge:verify <node-url> <paths...>` | Compares front-end code against the design and reports every mismatch |
| `/figma-bridge:page [summary\|tree\|texts\|colors]` | Shows what is currently in the cache, and how stale it is |
| `/figma-bridge:sync <figma-url>` | Pulls a file or node through the REST API (needs a Figma token) |
| `/figma-bridge:pair <code>` | Approves the Figma plugin that shows this 6-digit pairing code, so it receives the bridge token without anyone copying it |

The plugin resolves its own paths through `${CLAUDE_PLUGIN_ROOT}`, so nothing breaks when the clone moves. Its MCP server keeps the token and the cached designs in the [shared data directory](#where-data-lives), the same one Codex, agy and `figma-bridge start` use, and on its first start copies over what earlier versions kept in `${CLAUDE_PLUGIN_DATA}`.

The MCP server tries to listen on port 3456, and when it succeeds it is itself the endpoint the Figma plugin talks to — it serves both the Sync commands' `/design` and the `/bridge/*` routes — so install, open the panel in Figma, pair, done. It hosts the bridge while Claude Code runs; in between, the panel waits and reconnects by itself. When `figma-bridge start` or another session already holds the port, the MCP server reuses that bridge: they share the token, so it makes no difference to the Figma plugin which of them runs.

Only a bridge that keeps its own data directory gets in the way — one older than 1.3.0, or one started with `FIGMA_BRIDGE_DATA_DIR`. If it holds port 3456, the plugin's bridge tools fail with `NO_TOKEN` or `UNAUTHORIZED`, naming the fix: update or stop that bridge. `figma-bridge status` shows both directories when they differ.

#### Updating

```bash
figma-bridge update
```

Without the `figma-bridge` command, update the plugin directly:

```bash
claude plugin marketplace update figma-design-bridge
claude plugin update figma-bridge@figma-design-bridge
```

Then restart Claude Code (`/exit`, then `claude -c` to resume the conversation): a running session keeps the MCP server it started with, and that server keeps port 3456. Each Claude Code profile (`CLAUDE_CONFIG_DIR`) has its own plugin install, so update every profile you use. Close and reopen the Design Bridge panel in Figma to load the new plugin code. [CHANGELOG.md](CHANGELOG.md) lists what changed and any upgrade steps.

For Codex CLI, see [`integrations/codex/README.md`](integrations/codex/README.md).

### Configure in Claude Code manually

If you would rather not install the plugin, add to your `claude.json` or MCP config:

```json
{
  "mcpServers": {
    "figma-design-bridge": {
      "command": "figma-bridge",
      "args": ["mcp"],
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

The MCP server communicates with Claude Code via stdio and also starts the local
bridge on port 3456 — `/bridge/*` plus the `/design` routes the plugin's Sync
commands post to — or reuses the one already running there:

- `figma-bridge start` is reused: both use the [shared data
  directory](#where-data-lives) unless one of them is given another, so running
  both is safe.
- Anything else on that port — another program, or a bridge on a different data
  directory — does not stop the MCP server. The snapshot tools keep reading the
  data directory, and `get_bridge_status` and `get_design_context` report
  `PORT_OCCUPIED`, `BRIDGE_BUSY`, `NO_TOKEN` or `UNAUTHORIZED` with the fix, and
  keeps trying to take the port over in the background.
- When the process that owns the port exits, another running MCP server takes
  the port over within about 10 seconds, or at its next bridge call.
- When its MCP client closes stdin, the server answers the calls in flight,
  exits and frees the port. Started without any client (stdin already closed),
  it keeps hosting the bridge; `figma-bridge start` is the usual way to do that.

Restart the MCP client after changing its environment configuration.

> **Note:** On Windows, npm installs `figma-bridge` as a `.cmd` file, which an
> MCP client may not start directly. Use `"command": "cmd"` with
> `"args": ["/c", "figma-bridge", "mcp"]`, or `"command": "node"` with the
> absolute path to `server/mcp.mjs` in the install directory that
> `figma-bridge status` prints.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_design_context` | Read a Figma file or exact node through the connected plugin (`source` required; live by default). A node comes back as Figma's REST JSON with every attribute. `depth` (default 50, every level), `maxNodes` and `maxBytes` bound the result, and a cut layer stays as a placeholder the note names; `timeoutMs` (default 30000, up to 120000) bounds the wait; `fresh: true` reads again instead of reusing an unchanged read; `geometry: true` adds vector paths |
| `get_bridge_status` | Show bridge readiness, live plugin sessions, how many plugins wait for pairing approval, cache statistics, and setup hints |
| `approve_figma_pairing` | Approve the Figma plugin that shows this 6-digit pairing code (`code` required). Use only a code the user reads from the plugin |
| `sync_figma_design` | Explicitly fetch a Figma URL/file key, normalize it, and cache it locally |
| `get_design_summary` | Full markdown summary for an explicit `source` or the legacy snapshot |
| `get_design_tree` | ASCII tree for an explicit `source` or the legacy snapshot |
| `get_design_texts` | Text content for a node link (with `node-id`) or the legacy snapshot; a file link is refused |
| `get_design_colors` | Color palette for a node link (with `node-id`) or the legacy snapshot; a file link is refused |
| `search_design` | Search a node link (with `node-id`) or the legacy snapshot by node name/text (`q` required); a file link is refused |
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
figma-bridge start

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
| HTTP `401` from `/design` or `/snapshots` | Send the bridge token: `figma-bridge token`, then `-H "Authorization: Bearer <token>"`. In the Figma plugin, press **Pair with bridge**, or paste the token under **Advanced**. |
| The plugin says "No bridge is running at http://localhost:3456" | Open Claude Code, Codex or agy with the bridge set up, or run `figma-bridge start`, then press **Pair with bridge** again. |
| The panel stays on **Waiting for the bridge...** | Nothing runs at the bridge URL. Open Claude Code with the figma-bridge plugin — restart it if the plugin was installed during the session, and check that `/mcp` lists it — or run `figma-bridge start`. `figma-bridge status` shows what holds the port. The panel connects by itself. |
| The panel says **Pairing needed** | The bridge refused the saved token: it was rotated, or the bridge keeps its own data directory (older than 1.3.0, or started with `FIGMA_BRIDGE_DATA_DIR`). Press **Pair with bridge**. |
| **Pair with bridge** says the bridge is too old to pair | The bridge holding the port is older than 1.2.0, while the Figma plugin is newer. An older bridge answered pairing with `Missing or invalid bridge token`. Update whatever runs it: `claude plugin update figma-bridge@figma-design-bridge`, `codex plugin add figma-bridge@figma-design-bridge`, or `git pull` in the clone. Then restart it. `figma-bridge status` shows what holds the port. |
| "No Figma plugin is waiting with that code" | The pairing code expired (codes last two minutes) or was mistyped. Press **Pair with bridge** again and approve the new code. |
| HTTP `403` "addressed to a loopback host" | Reach the server as `localhost` or `127.0.0.1`, not through another host name or a reverse proxy that rewrites `Host`. |
| HTTP `403` "origin is not allowed" | The request came from a web page on a real origin. Only the Figma plugin iframe (`Origin: null`) and loopback origins are allowed. |
| `Missing FIGMA_ACCESS_TOKEN` | Export the token before starting the HTTP/MCP process, then restart it. |
| Figma API `403` | Verify `file_content:read` scope and that the token owner can view the file. |
| Figma API `429` | Wait for the reported retry period; use cached design tools instead of repeatedly syncing. |
| Import command cannot connect | Run `figma-bridge start` or an AI client with the bridge first; override with `FIGMA_BRIDGE_URL` if using a custom port. |
| Server port conflict | Set a custom port: `FIGMA_BRIDGE_PORT=4567 figma-bridge start` |
| Design seems incomplete | Import the full-file URL without `node-id`, or pass the required `nodeIds` explicitly. |
| MCP server not connecting | Run `figma-bridge status`, then `figma-bridge setup` to reinstall the plugin, and restart the client. In a hand-written MCP config, use `figma-bridge mcp` as the command. |
| `figma-bridge pair` says the bridge "rejected the token" | The bridge on port 3456 keeps a different data directory — usually a Claude Code session still running a plugin older than 1.3.0. [Update the plugin](#updating), restart Claude Code, then press **Pair with bridge** again. `figma-bridge status` shows whether the running bridge uses another data directory. |
| `figma-bridge start` says a bridge "uses another data directory" | A launcher that keeps its own data directory, or a version older than 1.3.0, holds port 3456 and would keep the Figma plugin on a different token. Stop or update it, then run `figma-bridge start` again. When the running bridge shares the data directory, `figma-bridge start` just says it is not needed. |
| `get_design_context` returns `TIMEOUT` | Reads of one file take turns in the plugin, and the error says how many were ahead. Figma also loads a large page slowly the first time it is read. Retry: a read the plugin was already working on answers the retry when it finishes. Otherwise pass a larger `timeoutMs` (up to 120000) or a smaller `depth` or `maxNodes`, and keep the panel open. |
| A read says `pluginOutdated: true`, or that Design Bridge is too old to export REST JSON | The panel open in Figma runs a plugin older than 1.5.0, which reads its own way and can miss attributes such as per-corner radii. Close Design Bridge and open it again: Figma loads the plugin's code anew. With a clone, `git pull` first. |
| A read says the bridge is older than the MCP server | Every agent session shares the bridge the first one started, and that one runs an older version. Close every Claude Code, Codex and agy session so the next one starts the new bridge, then reopen Design Bridge in Figma. |
| Figma's console shows `Plugin runtime aborted` and the panel closes; the read fails with `SESSION_LOST` | The read was too large for the plugin's memory. Reopen Design Bridge, then read one screen frame rather than a section of many screens, or pass a smaller `depth` or `maxNodes`, or `includeHidden: false`. A panel left open for hours is closer to the limit; reopening it starts fresh. |
| MCP tools return "No design data" | Call `sync_figma_design` with a Figma URL first. |

---

## Project Structure

```
figma-design-bridge/
├── bin/
│   └── figma-bridge.js        # The figma-bridge command npm puts on PATH
├── hooks/
│   ├── hooks.json             # Claude Code PreToolUse hook: reads run without a prompt while approvals is auto
│   └── allow-reads.js         # The hook itself; says nothing for manual or on any error
├── plugin/
│   ├── manifest.json          # Figma plugin manifest (networkAccess, enablePrivatePluginApi)
│   └── code.js                # Plugin panel: pairing, live /bridge/* reads, Sync to /design
├── server/
│   ├── data/                  # Data of versions before 1.3.0, copied to the shared directory (gitignored)
│   ├── config.json            # Optional settings in a clone (gitignored); config.json in the data directory wins
│   ├── cli/                   # figma-bridge setup, status, approvals, update, and the AI client setup
│   ├── tool-policy.js         # Which MCP tools only read, for annotations and approvals
│   ├── figma-api.js           # Figma REST client + schema normalizer
│   ├── figma-api.test.js      # Normalizer/import tests
│   ├── import-figma.mjs       # CLI importer
│   ├── bridge-token.js        # Prints/rotates the bridge token
│   ├── bridge-pair.js         # Approves a Figma plugin pairing code from the terminal
│   ├── data-dir.js            # Shared data-directory resolution + one-time migration
│   ├── package.json           # Server metadata
│   ├── index.js               # HTTP server
│   ├── legacy-routes.js       # /design, /figma/import, /snapshots (shared by both servers)
│   ├── snapshot-store.js      # latest.json + snapshots, reloaded when another process writes
│   ├── legacy-auth.test.js    # Access control on the snapshot routes
│   ├── mcp.mjs                # MCP server (requires @modelcontextprotocol/sdk)
│   ├── mcp.test.mjs           # MCP server over stdio: bridge startup, reuse, takeover, shutdown
│   └── bridge/                # Request-driven plugin bridge, mounted under /bridge/
│       ├── identity.js        # Figma URL/node-id parsing and cache keys
│       ├── cache.js           # Content-addressed cache, atomic writes
│       ├── broker.js          # Session registry, request queue, timeouts
│       ├── token.js           # Local bridge token
│       ├── pairing.js         # Pairing codes that hand the token to the plugin
│       ├── routes.js          # /bridge/* HTTP surface
│       ├── daemon.js          # Loopback daemon, safe start-or-reuse
│       ├── client.js          # Thin client for MCP adapters
│       ├── e2e.test.js        # End-to-end tests over real HTTP
│       └── *.test.js          # Unit tests for each module
├── docs/
│   ├── SERVER_API.md          # REST/snapshot server API
│   ├── BRIDGE_PROTOCOL.md     # /bridge/* route contract
│   └── PLAN_PLUGIN_ON_DEMAND_MCP.md  # Implementation plan and acceptance cases
├── .github/workflows/ci.yml   # Tests on Linux + Windows, Node 20/22/24, and the npm package contents
├── .github/workflows/release.yml  # Publishes @pixodeo/figma-bridge to npm, run by hand
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
