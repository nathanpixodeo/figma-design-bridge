# 🎨 Figma Design Bridge

**Bridge the gap between Figma designs and AI coding assistants.**

Figma Design Bridge lets you sync your Figma design data so that LLM-based CLI tools (like Claude CLI, Claude Code) can read, search, and understand your designs — no MCP Pro subscription or cloud service required. Comes with both an HTTP API and a native MCP server.

---

## Architecture

```
┌─────────────────┐     postMessage     ┌───────────────┐     POST /design    ┌───────────────────┐
│  Figma Desktop  │ ──────────────────> │  Plugin UI    │ ──────────────────> │  Local Server     │
│  or Web App     │  (hidden iframe)    │  (code.js)    │                     │  localhost:3456   │
│                 │                     │               │                     │                   │
│  Plugin runs    │                     │  Serializes   │                     │  Stores in memory │
│  sync command   │                     │  node tree &  │                     │  Exposes REST API │
│                 │                     │  sends JSON   │                     │                   │
└─────────────────┘                     └───────────────┘                     └────────┬──────────┘
                                                                                       │
                                                                          ┌────────────┼────────────┐
                                                                          │            │            │
                                                                   GET /design    GET /design   GET /design
                                                                   /summary       /tree         /search?q=
                                                                          │            │            │
                                                                          ▼            ▼            ▼
                                                                  ┌─────────────────────────────────────┐
                                                                  │        Claude CLI / curl            │
                                                                  │  "Understand this Figma design"     │
                                                                  └─────────────────────────────────────┘
```

### How It Works

1. **Figma Plugin** (`plugin/code.js`) — when you run "Sync Full Page" or "Sync Selected Nodes", the plugin traverses the current page's node tree and serializes every layer, frame, text, color, effect, auto-layout, and component instance into JSON.

2. **Hidden UI Bridge** — the plugin opens a tiny invisible iframe (`figma.showUI`) that receives the serialized data and forwards it via `fetch()` to your local server. This approach works on both **Figma Desktop** and **Figma Web** (unlike direct `fetch` from plugin sandbox).

3. **Local Server** (`server/index.js`) — a zero-dependency Node.js HTTP server that stores the latest design snapshot in memory, persists it to disk, and exposes a rich REST API for querying the design.

4. **Claude CLI / any HTTP client** — queries the server to read summaries, search nodes, extract text content, analyze colors, and more.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for the local server)
- [Figma Desktop](https://www.figma.com/downloads/) (or Figma Web)
- Figma plugin development enabled: `Figma > Plugins > Development > Import plugin from manifest...`

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd figma-bridge
```

No `npm install` needed — the server uses only Node.js built-in modules.

### 2. Start the Server

On first run, the server auto-creates `server/config.json` with default settings.

```bash
node server/index.js
```

You'll see:
```
  🎨 Design Bridge Server running on http://localhost:3456
  ─────────────────────────────────────────────
  Config loaded from server/config.json
  Run the "Design Bridge" plugin in Figma to sync
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

### 3. Import the Figma Plugin

1. Open **Figma Desktop**
2. Click `Plugins` → `Development` → `Import plugin from manifest...`
3. Select `figma-bridge/plugin/manifest.json`
4. The plugin "Design Bridge" now appears under `Plugins > Development > Design Bridge`

### 4. Sync a Design

1. Open any Figma design file
2. Navigate to the page you want to analyze
3. Right-click → `Plugins` → `Development` → `Design Bridge` → **Sync Full Page**
4. You'll see a notification: `✅ Synced 142 nodes to server`

To sync only specific layers: select them first, then choose **Sync Selected Nodes**.

### 5. Query from Claude CLI

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

Receive design data from the Figma plugin. Sent automatically when you run the plugin.

The server validates incoming data and returns proper error codes:
- `400` — invalid or missing fields
- `413` — payload exceeds maximum size

```bash
curl -X POST http://localhost:3456/design \
  -H "Content-Type: application/json" \
  -d '{"pageName":"Page 1","nodes":[...],"nodeCount":142}'
```

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

Design snapshots are automatically saved to `data/snapshots/` after each sync. On restart, the server loads the latest snapshot from disk, so your design survives server restarts. The server keeps a maximum of 50 snapshots, pruning the oldest automatically.

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

## Plugin Details

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
      "args": ["/absolute/path/to/figma-bridge/server/mcp.mjs"]
    }
  }
}
```

The MCP server starts its own HTTP endpoint on port 3456 for the Figma plugin to POST to, and communicates with Claude Code via stdio. **No separate HTTP server needed.**

> **Note:** Use the absolute path to `server/mcp.mjs` in your MCP config.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_design_summary` | Full markdown summary: screens, layer tree, text, colors, structure |
| `get_design_tree` | ASCII tree of all layers with types, names, dimensions |
| `get_design_texts` | All text content with font info and layer paths |
| `get_design_colors` | Color palette grouped by usage frequency |
| `search_design` | Search nodes by name or text content (`q` parameter) |
| `get_design_info` | Basic info: page name, node count, sync timestamp |

### Usage Flow with MCP

1. Start Claude Code (it auto-starts the MCP server)
2. In Figma: `Plugins > Development > Design Bridge > Sync Full Page`
3. In Claude Code, ask:
   - *"What's in the current Figma design?"*
   - *"Extract all the text content and rewrite the hero section copy"*
   - *"Search for all button components in the design"*
   - *"Analyze the color palette and suggest an accessible alternative"*

Design data persists to disk, so it survives between Claude Code sessions. You only need to re-sync from Figma when the design changes.

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
| `Cannot connect to server` in Figma | Make sure `node server/index.js` is running. Check port `3456` isn't blocked by a firewall. |
| Plugin not appearing in menu | Re-import the manifest in Figma: `Plugins > Development > Import plugin from manifest...` |
| `Fetch failed` on Figma Web | The UI bridge approach should work on web Figma. If it doesn't, try Figma Desktop instead. |
| Server port conflict | Set a custom port: `FIGMA_BRIDGE_PORT=4567 node server/index.js` |
| Design seems incomplete | Some properties may fail to serialize (e.g., unloaded fonts). These are caught by try-catch and skipped. |
| MCP server not connecting | Make sure `npm install` was run. Use absolute path to `server/mcp.mjs` in config. |
| MCP tools return "No design data" | Run the Figma plugin first: `Plugins > Design Bridge > Sync Full Page` |

---

## Project Structure

```
figma-bridge/
├── data/
│   └── snapshots/             # Auto-saved design snapshots (max 50, pruned)
├── plugin/
│   ├── manifest.json          # Figma plugin manifest
│   └── code.js                # Plugin code with node serializer + UI bridge
├── server/
│   ├── config.json            # Auto-created config (port, dataDir, maxSnapshots, logLevel)
│   ├── package.json           # Server metadata
│   ├── index.js               # HTTP server (zero dependencies)
│   └── mcp.mjs                # MCP server (requires @modelcontextprotocol/sdk)
├── docs/
│   └── SERVER_API.md          # Detailed API documentation
├── README.md
└── .gitignore
```

---

## License

MIT
