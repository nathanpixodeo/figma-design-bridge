# Server API Documentation

Base URL: `http://localhost:3456` (configurable via `FIGMA_BRIDGE_PORT`)

All endpoints return JSON unless otherwise noted. CORS headers are set on every response (`Access-Control-Allow-Origin: *`). Design data can be imported through the official Figma REST API; the legacy plugin ingestion endpoint remains supported.

> This project also includes a **native MCP server** (`server/mcp.mjs`) — see the [README](../README.md#mcp-model-context-protocol-support) for Claude Code integration.

---

## `GET /health`

Server health check and endpoint discovery.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "port": 3456,
  "hasDesign": true,
  "pageName": "Page 1",
  "nodeCount": 142,
  "snapshotCount": 5,
  "dataDir": "./server/data",
  "endpoints": [
    "GET  /",
    "POST /figma/import",
    "POST /design",
    "GET  /design",
    "DELETE /design",
    "GET  /design/summary",
    "GET  /design/tree",
    "GET  /design/texts",
    "GET  /design/colors",
    "GET  /design/search?q=",
    "GET  /health",
    "GET  /snapshots",
    "GET  /snapshots/:filename"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"ok"` if server is running |
| `port` | number | Port the server is listening on |
| `hasDesign` | boolean | Whether design data has been synced |
| `pageName` | string or null | Name of the synced Figma page |
| `nodeCount` | number | Total number of nodes in the synced design |
| `snapshotCount` | number | Number of snapshots saved on disk |
| `dataDir` | string | Path to the bridge data directory |
| `endpoints` | string[] | List of available endpoints |

---

## `POST /figma/import`

Fetches a Figma file or selected nodes through the official Figma REST API, converts the response to the bridge schema, saves a snapshot, and makes it the current design.

The server process must have a personal access token in `FIGMA_ACCESS_TOKEN` (or the legacy alias `FIGMA_TOKEN`). The token needs `file_content:read` scope and is never included in the saved snapshot.

**Request Body:**

```json
{
  "source": "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2",
  "nodeIds": ["3:4", "5:6"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Figma design URL or file key |
| `nodeIds` | string[] | No | Nodes to fetch; overrides `node-id` from the URL |

When neither `nodeIds` nor URL `node-id` is supplied, the complete file is fetched. Reading summary/tree/search endpoints afterward uses the local cache and does not call Figma again.

**Response `200 OK`:**

```json
{
  "message": "Imported 142 nodes from Figma",
  "pageName": "Landing Page",
  "fileName": "Website",
  "nodeCount": 142,
  "source": "figma-rest-api",
  "snapshot": "2026-06-18T10-30-00.000Z.json"
}
```

**Response `502 Bad Gateway`:**

```json
{
  "error": "Figma API 403: Forbidden."
}
```

Common causes are a missing/invalid token, missing `file_content:read` scope, no access to the file, or Figma API rate limiting.

---

## `POST /design`

Receive already-normalized bridge data. The legacy Figma plugin and the `import:figma` CLI use this endpoint.

**Request Body:**

```json
{
  "type": "page",
  "pageName": "Page 1",
  "pageId": "0:1",
  "nodes": [ { ... } ],
  "nodeCount": 142,
  "syncedAt": "2026-06-15T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"file"`, `"page"`, or `"selection"` |
| `pageName` | string | Name of the Figma page |
| `pageId` | string | Figma internal page ID |
| `nodes` | object[] | Array of serialized node trees |
| `nodeCount` | number | Total flattened node count (all descendants) |
| `syncedAt` | string (ISO) | Timestamp when the data was imported or synced |
| `selectionCount` | number | (only when `type: "selection"`) How many nodes were selected |

**Response `200 OK`:**

```json
{
  "message": "Synced 142 nodes from \"Page 1\"",
  "nodeCount": 142
}
```

**Response `400 Bad Request`:**

```json
{
  "error": "Invalid JSON"
}
```

---

## `GET /design`

Returns the current normalized design data, whether it came from Figma REST import or the legacy plugin.

**Response `200 OK`:**

```json
{
  "pageName": "Page 1",
  "pageId": "0:1",
  "type": "page",
  "nodes": [ ... ],
  "nodeCount": 142,
  "syncedAt": "2026-06-15T12:00:00.000Z"
}
```

**When no data is synced:**

```json
{
  "message": "No design data loaded yet. Import a Figma URL first."
}
```

---

## `DELETE /design`

Clears the current design data from memory. Saved snapshots on disk are not affected.

**Response `200 OK`:**

```json
{
  "message": "Design data cleared from memory. Snapshots remain on disk."
}
```

---

## `GET /design/summary`

Generates a comprehensive **Markdown summary** of the design.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `"markdown"` | Only `"markdown"` is supported (returns `text/markdown` content type) |

**Response `200 OK`** (Content-Type: `text/markdown`):

```markdown
# Design Summary: Page 1

## Screens

- **Home Screen** [FRAME] — 375×812, auto-layout: VERTICAL, 142 nodes total

## Layer Tree

```
Page 1
└── FRAME "Home Screen" [375×812]
    ├── RECTANGLE "Background" [375×812] #FFFFFF
    ├── TEXT "Welcome" [300×40] "Welcome to the App"
    ...
```

## Text Content

| # | Path | Text | Font | Size |
|---|------|------|------|------|
| 1 | Page 1 > Home Screen > Welcome | Welcome to the App | Inter | 24 |

## Color Palette

| Color | Usage |
|-------|-------|
| #FFFFFF | Background (1x) |
| #007AFF | Button Fill (2x) |

## Structure

- Total nodes: 142
- Components: 12
- Instances: 8
- Text nodes: 34
- Top-level frames: 3
```

---

## `GET /design/tree`

Returns a plain-text ASCII tree visualization of the layer hierarchy.

**Response `200 OK`** (Content-Type: `text/plain`):

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
        ├── FRAME "Card 1" [160×200] #FFFFFF
        │   ├── RECTANGLE "Image Placeholder" [160×140] #E5E5E5
        │   ├── TEXT "Card Title" [140×20] "Getting Started"
        │   └── TEXT "Card Description" [140×30] "Learn how to use our platform"
        └── FRAME "Card 2" [160×200] #FFFFFF
            ├── RECTANGLE "Image Placeholder" [160×140] #E5E5E5
            ├── TEXT "Card Title" [140×20] "Advanced Tips"
            └── TEXT "Card Description" [140×30] "Take your skills further"
```

Each line shows:
- `TYPE "Name" [width×height]`
- For text nodes: `"first 50 characters..."`
- For nodes with SOLID fills: hex color `#FFFFFF`
- For auto-layout frames: layout mode `[HORIZONTAL]` or `[VERTICAL]`

---

## `GET /design/texts`

Extracts every text node from the design with full metadata.

**Response `200 OK`:**

```json
{
  "texts": [
    {
      "path": "Page 1 > Home Screen > Welcome Title",
      "id": "1234:5678",
      "name": "Welcome Title",
      "characters": "Welcome to the App",
      "fontSize": 24,
      "fontFamily": "Inter",
      "fontStyle": "Bold",
      "color": "#1C1C1E"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Dot-separated path from page root to the node |
| `id` | string | Figma node ID |
| `name` | string | Layer name in Figma |
| `characters` | string | The actual text content |
| `fontSize` | number | Font size in px |
| `fontFamily` | string or null | Font family name |
| `fontStyle` | string or null | Font style (Regular, Bold, Medium, etc.) |
| `color` | string or null | Text fill color as hex |

---

## `GET /design/colors`

Extracts all colors used in fills and strokes across the design.

**Response `200 OK`:**

```json
{
  "colors": {
    "#1C1C1E": [
      { "node": "Title", "prop": "fill" },
      { "node": "Body Text", "prop": "fill" }
    ],
    "#007AFF": [
      { "node": "Primary Button", "prop": "fill" }
    ],
    "#E5E5E5": [
      { "node": "Divider", "prop": "stroke" }
    ]
  }
}
```

The response is grouped by color hex value. Each entry lists every node and property (`fill` or `stroke`) that uses that color.

Color keys are sorted by frequency (most used first). Colors come from:
- SOLID fill paints
- SOLID stroke paints

---

## `GET /design/search?q=<query>`

Search for nodes by name or text content. Case-insensitive.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes | Search term (case-insensitive) |

**Response `200 OK`:**

```json
{
  "query": "button",
  "results": [
    {
      "id": "1234:5678",
      "name": "Primary Button",
      "type": "FRAME",
      "path": "Page 1 > Home Screen > Primary Button",
      "characters": null,
      "width": 200,
      "height": 48,
      "x": 88,
      "y": 500
    },
    {
      "id": "1234:5679",
      "name": "Button Label",
      "type": "TEXT",
      "path": "Page 1 > Home Screen > Primary Button > Button Label",
      "characters": "Sign Up",
      "width": 80,
      "height": 20,
      "x": 148,
      "y": 514
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | The original search query |
| `results` | object[] | Matching nodes |

Each result includes:
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Figma node ID |
| `name` | string | Layer name |
| `type` | string | Figma node type |
| `path` | string | Full path from page root |
| `characters` | string or null | Text content (only for TEXT nodes) |
| `width` | number | Node width in px |
| `height` | number | Node height in px |
| `x` | number | X position relative to parent |
| `y` | number | Y position relative to parent |

---

## `GET /snapshots`

Lists all saved snapshot files on disk.

**Response `200 OK`:**

```json
{
  "snapshots": [
    {
      "filename": "2026-06-15T12-00-00-000Z.json",
      "size": 12345,
      "pageName": "Page 1",
      "nodeCount": 142,
      "syncedAt": "2026-06-15T12:00:00.000Z",
      "savedAt": "2026-06-15T12:00:01.000Z"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filename` | string | Snapshot filename (ISO timestamp with dashes) |
| `size` | number | File size in bytes |
| `pageName` | string | Name of the Figma page |
| `nodeCount` | number | Total number of nodes in the snapshot |
| `syncedAt` | string (ISO) | Timestamp when the design data was imported or synced |
| `savedAt` | string (ISO) | Timestamp when the snapshot was written to disk |

---

## `GET /snapshots/:filename`

Loads a specific snapshot by filename.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `filename` | string | Snapshot filename (e.g. `2026-06-15T12-00-00-000Z.json`) |

**Response `200 OK`:**

Returns the full snapshot data — same schema as `GET /design`.

**Response `404 Not Found`:**

```json
{
  "error": "Snapshot not found"
}
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request (e.g., missing query parameter) |
| `404` | Endpoint not found |
| `413` | Payload too large (max 50 MB) |
| `502` | Figma REST API import failed |

Error responses follow this format:

```json
{
  "error": "Missing \"q\" parameter"
}
```

---

## CORS

All responses include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Preflight `OPTIONS` requests are handled with HTTP 204.

---

## Content Types

| Endpoint | Content Type |
|----------|-------------|
| All JSON endpoints | `application/json` |
| `GET /design/summary` | `text/markdown; charset=utf-8` |
| `GET /design/tree` | `text/plain; charset=utf-8` |
