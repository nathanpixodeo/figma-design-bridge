# 🎨 Figma Design Bridge

**Let AI coding assistants read Figma designs without installing a Figma plugin.**

Figma Design Bridge imports design data through the official Figma REST API, normalizes it into an agent-friendly local snapshot, and exposes it through both HTTP and MCP. A legacy Figma plugin remains available, but it is no longer required.

---

## Architecture

```text
Figma URL + Personal Access Token
                 │
                 ▼
       Official Figma REST API
                 │
                 ▼
     Normalize and cache locally
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

1. `server/figma-api.js` parses a Figma URL and requests either the full file or the `node-id` embedded in the URL.
2. The REST response is normalized into the same compact schema used by the bridge: dimensions, text, colors, effects, auto-layout, components, and child nodes.
3. The normalized design is saved to `server/data/latest.json` plus timestamped snapshots.
4. Agents query the cached data. Reading/searching never calls Figma again; only an explicit sync consumes an API request.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for the local server)
- A Figma account that can view the target file
- A Figma personal access token with `file_content:read` scope

See Figma's [authentication guide](https://developers.figma.com/docs/rest-api/authentication/) to create a token. Starter accounts are subject to Figma's API limits, so the bridge caches every successful import.

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

Set the token in the shell that starts the bridge. Never commit it to the repository.

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

You can also override the port via environment variable:
```bash
FIGMA_BRIDGE_PORT=4567 node server/index.js
```

### 3. Import a Design from Chrome

Copy the design URL from Chrome. If the URL contains `node-id`, only that node is imported; otherwise the full file is imported.

```powershell
npm run import:figma -- "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"
```

Alternatively, ask the running HTTP server to fetch it:

```bash
curl -X POST http://localhost:3456/figma/import \
  -H "Content-Type: application/json" \
  -d '{"source":"https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"}'
```

### 4. Query the Cached Design

Once the design is synced, point Claude CLI to the server:

```bash
# Get a markdown summary of the entire design
curl http://localhost:3456/design/summary

# ASCII tree of the layer hierarchy
curl http://localhost:3456/design/tree

# All text content extracted from the design
curl http://localhost:3456/design/texts

# Color palette analysis
curl http://localhost:3456/design/colors

# Search nodes by name or text content
curl "http://localhost:3456/design/search?q=button"

# Full JSON design tree
curl http://localhost:3456/design
```

---

## Server API Reference

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

Receive already-normalized design data. This endpoint remains compatible with the legacy plugin and is also used by the CLI importer.

The server validates incoming data and returns proper error codes:
- `400` — invalid or missing fields
- `413` — payload exceeds maximum size

```bash
curl -X POST http://localhost:3456/design \
  -H "Content-Type: application/json" \
  -d '{"pageName":"Page 1","nodes":[...],"nodeCount":142}'
```

### `POST /figma/import`

Fetch a Figma URL or file key through the official REST API, normalize it, cache it, and make it the current design. The server process must have `FIGMA_ACCESS_TOKEN` set.

```bash
curl -X POST http://localhost:3456/figma/import \
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
curl http://localhost:3456/design/texts
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
curl http://localhost:3456/design/colors
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
curl "http://localhost:3456/design/search?q=button"
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
curl -X DELETE http://localhost:3456/design
```

```json
{ "status": "ok", "message": "Design cleared" }
```

### `GET /snapshots`

Lists all saved design snapshots on disk.

```bash
curl http://localhost:3456/snapshots
```

```json
{
  "snapshots": [
    { "filename": "design-2026-06-15T10-30-00.json", "size": 28416, "savedAt": "2026-06-15T10:30:00.000Z" }
  ]
}
```

### `GET /snapshots/:filename`

Loads a specific snapshot into memory, replacing the current design.

```bash
curl http://localhost:3456/snapshots/design-2026-06-15T10-30-00.json
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

## Legacy Plugin (Optional)

The original Desktop development plugin is retained for users who can install local plugins. REST import is the primary path and does not require this plugin.

### Menu Commands

| Command | Action |
|---------|--------|
| **Sync Full Page** | Serializes all nodes on the current page |
| **Sync Selected Nodes** | Serializes only the nodes currently selected in the editor |
| **Watch Mode (Auto-Sync)** | Opens a persistent UI panel that auto-syncs on selection change with debounce. Includes Sync Now button and Auto-sync toggle. |

### Watch Mode

Watch Mode opens a persistent UI panel in Figma that stays open while you work. As you select different layers or frames, the plugin debounces and auto-syncs the selected nodes to the server — no manual re-syncing needed.

- **Auto-sync toggle** — enable or disable automatic syncing from the panel
- **Sync Now button** — trigger an immediate sync of the current selection
- **Debounce** — selection changes are debounced to avoid flooding the server during rapid selection changes

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

### Configure in Claude Code

Add to your `claude.json` or MCP config:

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

The MCP server communicates with Claude Code via stdio and also starts a local HTTP endpoint on port 3456. **No separate HTTP server is needed.** Restart the MCP client after changing its environment configuration.

> **Note:** Use the absolute path to `server/mcp.mjs` in your MCP config.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `sync_figma_design` | Explicitly fetch a Figma URL/file key, normalize it, and cache it locally |
| `get_design_summary` | Full markdown summary: screens, layer tree, text, colors, structure |
| `get_design_tree` | ASCII tree of all layers with types, names, dimensions |
| `get_design_texts` | All text content with font info and layer paths |
| `get_design_colors` | Color palette grouped by usage frequency |
| `search_design` | Search nodes by name or text content (`q` parameter) |
| `get_design_info` | Basic info: page name, node count, sync timestamp |

### Usage Flow with MCP

1. Export `FIGMA_ACCESS_TOKEN` before starting Claude Code.
2. Start Claude Code; it auto-starts the MCP server.
3. Ask: *"Sync this Figma design: https://www.figma.com/design/..."*
4. After it is cached, ask:
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
curl http://localhost:3456/design/summary | \
  claude -p "Analyze this Figma design and suggest improvements"
```

Or search for specific elements:

```bash
TEXTS=$(curl -s http://localhost:3456/design/texts)
claude -p "Based on these text nodes, write better copy for the landing page: $TEXTS"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
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
│   ├── manifest.json          # Optional legacy Figma plugin
│   └── code.js
├── server/
│   ├── data/                  # latest.json + timestamped snapshots (gitignored)
│   ├── config.json            # Auto-created config (port, dataDir, maxSnapshots, logLevel)
│   ├── figma-api.js           # Figma REST client + schema normalizer
│   ├── figma-api.test.js      # Normalizer/import tests
│   ├── import-figma.mjs       # CLI importer
│   ├── package.json           # Server metadata
│   ├── index.js               # HTTP server
│   └── mcp.mjs                # MCP server (requires @modelcontextprotocol/sdk)
├── docs/
│   └── SERVER_API.md          # Detailed API documentation
├── README.md
└── .gitignore
```

---

## License

MIT
