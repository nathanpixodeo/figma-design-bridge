# Bridge Protocol (`/bridge/*`)

Status: **implemented and accepted in a real Figma session on Windows.** Both
`figma-bridge start` and the MCP server mount these routes, and the Figma plugin's
panel pairs, opens a session and answers reads. See
[Known limitations](#known-limitations) and
[the implementation plan](https://github.com/nathanpixodeo/figma-design-bridge/blob/main/docs/PLAN_PLUGIN_ON_DEMAND_MCP.md).

This document describes the request-driven bridge: a shared loopback daemon that
lets an MCP client paste a Figma node URL and read that node live, out of the
open Figma document, through the plugin — with no REST token and no manual
sync step.

For the existing REST-import and snapshot server, see [SERVER_API.md](./SERVER_API.md).
The two surfaces coexist on the same port: anything under `/bridge/` is handled
by this protocol, everything else falls through to the legacy routes.

---

## Roles

```text
MCP client (Claude Code, Codex, …)      Figma plugin UI
            │                                  │
            │ POST /bridge/read                │ POST   /bridge/session
            │                                  │ GET    /bridge/session/:id/poll
            ▼                                  │ POST   /bridge/session/:id/reply
     shared loopback bridge  ◄─────────────────┘
       ├── request broker  (routes a read to a session that owns that file)
       └── content cache   (file key + node id + representation)
```

The plugin is the only thing that can answer a read. The bridge never falls back
to the Figma REST API, and never substitutes cached data for a live read.

---

## Authentication

Every route except `GET /bridge/health` and the two pairing routes a plugin uses to obtain the token (see [Pairing](#pairing)) requires the **bridge token**:

```
Authorization: Bearer <bridge token>
```

The token is a 32-byte random value stored in `<dataDir>/bridge-token.json`,
created on first daemon start. That path is covered by `.gitignore`
(`**/bridge-token.json`). The token is never included in a health response, a
session listing, a log line, an error message or a URL — reveal it deliberately
when pairing the plugin, and treat it like any other local credential.

Session routes require a **second** credential on top of the token, the session
secret returned by `POST /bridge/session`:

```
X-Session-Secret: <session secret>
```

This is what stops one plugin session from polling, answering or invalidating
another session's file.

Two further guards apply to every `/bridge/*` request:

- **Host check.** The `Host` header must name a loopback host (`localhost`,
  `127.0.0.1`, `[::1]`). A hostile page that resolves its own domain to
  127.0.0.1 is rejected here, before any body is read.
- **Origin allowlist.** CORS is granted only to configured origins, defaulting
  to the literal string `null` — the opaque origin a Figma plugin iframe posts
  from. A wildcard `*` is filtered out of the allowlist and is never sent on an
  authenticated route.

Request bodies are capped at 2,000,000 bytes (`413 PAYLOAD_TOO_LARGE`), except
a plugin reply (`POST /bridge/session/:id/reply`), which may carry up to
11,000,000 bytes: the largest `maxBytes` a read can ask for plus 1,000,000 bytes
of envelope. Every route rejects unknown fields rather than ignoring them.

---

## Routes

| Method | Path | Credentials |
|--------|------|-------------|
| `GET` | `/bridge/health` | none |
| `POST` | `/bridge/session` | token |
| `POST` | `/bridge/session/:id/heartbeat` | token + session secret |
| `GET` | `/bridge/session/:id/poll` | token + session secret |
| `POST` | `/bridge/session/:id/reply` | token + session secret |
| `POST` | `/bridge/session/:id/invalidate` | token + session secret |
| `DELETE` | `/bridge/session/:id` | token + session secret |
| `POST` | `/bridge/read` | token |
| `GET` | `/bridge/status` | token |
| `POST` | `/bridge/handoff` | token, no `Origin` header |
| `POST` | `/bridge/pair` | none (see [Pairing](#pairing)) |
| `GET` | `/bridge/pair/:id` | pairing secret |
| `POST` | `/bridge/pair/approve` | token |

---

### `GET /bridge/health`

Unauthenticated liveness and identity probe. Used by `startOrReuse` to decide
whether a listener already on the port is this bridge or a foreign process.

```json
{
  "status": "ok",
  "service": "figma-design-bridge",
  "protocolVersion": "1.0",
  "serverVersion": "1.12.0"
}
```

`serverVersion` is the version of the figma-bridge server that owns the port.
Since 1.12.0; a bridge from before then leaves it out. A newer server uses it
to ask an older owner to hand the port over (see
[`POST /bridge/handoff`](#post-bridgehandoff)).

It deliberately carries nothing else — no token, no file keys, no session list,
no data directory.

---

### `POST /bridge/session`

Registers a plugin instance as the answering session for one Figma file.

**Request:**

```json
{
  "fileKey": "abc123DEF456",
  "fileName": "Website",
  "pluginInstanceId": "plugin-7f3c",
  "capabilities": ["read-node", "read-document-index", "figma-rest", "edit-seq", "assets", "render", "search"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `fileKey` | Yes | Figma file key, `[A-Za-z0-9_-]{1,128}` |
| `fileName` | No | Display name, max 200 characters |
| `pluginInstanceId` | Yes | Identifies this plugin instance |
| `capabilities` | No | Up to 16 short identifiers |

| Capability | Meaning |
|------------|---------|
| `read-node`, `read-document-index` | Answers those ops |
| `figma-rest` | Exports a node as Figma's REST JSON (representation `figma-rest`), since 1.5.0 |
| `edit-seq` | Answers `edit-seq` at once with its edit count, which lets the bridge reuse its reads, since 1.5.0 |
| `assets` | Exports a node's icons as SVG and its images as their files (representation `assets`), since 1.6.0 |
| `render` | Renders a node as PNG, JPG or SVG (representation `render`), since 1.6.0 |
| `search` | Searches a node's layers by name and text itself (representation `search`), since 1.11.0 |

A read asking for `figma-rest` from a session without that capability is
served as `node-subtree` instead, and the response says `pluginOutdated: true`.
A live read asking for `assets`, `render` or `search` from a session without that
capability is refused with `409 PLUGIN_OUTDATED`: no other read can stand in
for it.

**Response `201 Created`:**

```json
{
  "sessionId": "s_9f2a…",
  "sessionSecret": "…",
  "registeredAt": "2026-09-17T10:00:00.000Z",
  "protocolVersion": "1.0"
}
```

`sessionSecret` is shown exactly once. The plugin holds it in memory for the
lifetime of the session and sends it as `X-Session-Secret` on every other
session route.

---

### `POST /bridge/session/:id/heartbeat`

Keeps the session alive and reports queue depth. A session that stops sending
heartbeats is reaped, and its pending requests are failed with `SESSION_LOST`
rather than left hanging.

```json
{ "ok": true, "pendingCount": 0, "protocolVersion": "1.0" }
```

---

### `GET /bridge/session/:id/poll?waitMs=25000`

Long-poll for work. Returns as soon as there is at least one queued request, or
empty when `waitMs` elapses.

`waitMs` is clamped to 0–30000 and defaults to 25000.

```json
{
  "requests": [
    {
      "requestId": "r_41b0…",
      "op": "read-node",
      "params": {
        "fileKey": "abc123DEF456",
        "nodeId": "1:23",
        "representation": "figma-rest",
        "options": { "representation": "figma-rest" }
      },
      "enqueuedAt": 1789639205000,
      "expiresAt": 1789639235000
    }
  ],
  "waitMs": 25000
}
```

`op` is `read-node` when the read named a node, or `read-document-index` when it
named a bare file URL. `edit-seq` asks for the plugin's edit count, which every
edit Figma reports to the plugin moves on; the plugin answers it at once with
`{ "fileKey": "…", "editSeq": 7 }`, outside its read queue, even in the middle
of a read.

Since 1.12.0 the bridge keeps each session's queue and hands a poll only the
reads the plugin can start now, in two lanes:

| Lane | Reads | In the plugin at once |
|------|-------|-----------------------|
| heavy | `read-node` as `figma-rest`, `node-subtree`, `assets` or `render` | 1 |
| light | `read-node` as `search`, and `read-document-index` | 2 |
| instant | `edit-seq`, `ping` | no limit, handed at once |

A handed read holds its lane until the plugin replies, even after its caller
timed out, or until 15 s after its `expiresAt`. `enqueuedAt` is the moment the
read was handed out, so the plugin counts the read's `timeoutMs` from then.

The plugin serves the heavy lane one read at a time, in the order they arrive,
and the light lane on a queue of its own beside it: a search does not wait for
another caller's export of a large frame. A read has a deadline a little before
`expiresAt`: a fifth of the time between `enqueuedAt` and `expiresAt`, between
1 and 5 seconds, is left for the answer to reach the bridge. A read that
reaches its turn after that deadline is refused at once with an error that says
so, which also frees its lane. One that is still
running at the deadline stops, and answers with what it read (see
[A read cut by its deadline](#a-read-cut-by-its-deadline)). A read waiting right behind the same read (same op, node,
representation and options) is answered with that read's result when no edit
came in since it began, which is what a caller retrying after a timeout asks
for.

If the plugin's connection closes before the answer was fully sent, the poll is
dropped and the requests it held go back to the front of the session's queue,
for the next poll. A poll answer that went out in full is never resent.

When several live sessions serve the same file — a panel reopened before the old
session expired, for one — reads go to the session heard from most recently
(registration, heartbeat, poll or invalidate); a tie goes to the one with a poll waiting,
then to the newer registration. A new session under the same
`pluginInstanceId` replaces the old one, as before; one under a different id
leaves the old session alive but stops sending it reads.

---

### `POST /bridge/session/:id/reply`

Delivers a result for one polled request.

```json
{
  "requestId": "r_41b0…",
  "ok": true,
  "result": {
    "fileKey": "abc123DEF456",
    "fileName": "Website",
    "nodeId": "1:23",
    "pageId": "0:1",
    "pageName": "Page 1",
    "found": true,
    "truncated": false,
    "completeness": { "nodeCount": 142, "byteSize": 28416, "limitHit": false, "truncatedNodeIds": [] },
    "format": "figma-rest",
    "editSeq": 7,
    "timing": { "countMs": 12, "exportMs": 180, "totalMs": 240 },
    "payload": { }
  }
}
```

### A read cut by its deadline

Figma can leave a call unsettled, such as an export inside a very large section.
The plugin waits for each Figma call no longer than the read's deadline, so
the read never holds the reads behind it. A read that reaches the deadline
turns every layer it has not read into a placeholder, as `maxNodes` does. It
answers with `truncated: true`, `completeness.stoppedBy: "time"` and
`timing.stalled: { step, nodeId, ms }`. `step` names the Figma call it was
waiting on: `load`, `export`, `variable`, `geometry` or `image`. When the layer
itself does not load in time, or an `assets` or `render` export does not finish,
the read fails with an error that says so. The bridge does not cache a read cut
by its deadline, and the plugin does not reuse it for a retry: the next read may
have more time.

`editSeq` is the plugin's edit count when the read began. `format` says how the
payload is laid out, `timing` how long the read took, and `fallbackReason` why a
`figma-rest` read came back as `node-subtree`.

**Response `200 OK`:**

```json
{ "accepted": true, "reason": null }
```

A reply that arrives after its request already timed out, or that names a
request belonging to a different session, is **not** an error — it answers
`200 { "accepted": false, "reason": "…" }` so the plugin can discard the work and
move on. Such a reply never reaches a waiting caller. A successful read reply
from the session the request went to is still cached as a live read, so the
caller's retry can be answered from it, unless the cache already holds a read of
that node from that session that began at a higher edit count.

---

### `POST /bridge/session/:id/invalidate`

Called by the plugin when the document changes. Drops cached entries for the
file this session registered.

```json
{ "reason": "plugin-documentchange" }
```

The file is taken from the registered session, never from the body. Passing a
`fileKey` that is not this session's file returns `403 FILE_MISMATCH`.

**Response `200 OK`:**

```json
{ "fileKey": "abc123DEF456", "invalidated": 12, "reason": "plugin-documentchange" }
```

Invalidation is currently file-wide, which is conservative but correct. An edit
made while the plugin is in the middle of a read is reported after that read's
reply, so it also drops the entry the reply just cached, which may mix content
from before and after the edit.

---

### `DELETE /bridge/session/:id?reason=plugin-stop`

Closes the session. Any requests still queued for it are rejected immediately
with `SESSION_LOST` instead of waiting out their timeouts.

```json
{ "closed": true, "rejected": 0 }
```

---

### `POST /bridge/read`

The route an MCP adapter calls with the URL a user pasted.

**Request:**

```json
{
  "source": "https://www.figma.com/design/FILE_KEY/Design?node-id=1-23",
  "mode": "live",
  "timeoutMs": 30000,
  "options": { "representation": "figma-rest", "depth": 50, "maxNodes": 5000 }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `source` | Yes | Figma URL or bare file key, max 2000 characters |
| `mode` | No | `"live"` (default) or `"cached"` |
| `timeoutMs` | No | 1–120000, default 30000 |
| `fresh` | No | `true` reads again instead of reusing an unchanged read (see [Reuse](#reuse)). Since 1.5.0; send it only when `true`, since an older bridge rejects the field |
| `queueWaitMs` | No | 0–120000, default 0. How long the read may wait for its lane on top of `timeoutMs`. `timeoutMs` then counts from when the plugin is handed the read, or from when its lane has room if the plugin is not polling. With 0, as before 1.12.0, the wait counts against `timeoutMs`. Since 1.12.0; send it only when above 0, since an older bridge rejects the field. The MCP server sends 60000 |
| `options` | No | See below |

| Option | Range | Plugin default |
|--------|-------|----------------|
| `representation` | short identifier, `[A-Za-z0-9_.+-]{1,40}` | `node-subtree` or `document-index` |
| `depth` | integer 0–50 | 50, every level (an older plugin reads 12 and at most 30) |
| `maxNodes` | integer 1–20000 | 5000 |
| `maxBytes` | integer 1024–10000000, in UTF-8 bytes of the serialized payload | 2000000 |
| `includeHidden` | boolean; hidden layers come back with `visible: false` | `true` |
| `query` | string of 1–200 characters; required with `search`, refused with any other representation | none |

`representation` names how a node is read:

- `figma-rest` (what the MCP server asks for since 1.5.0): Figma's REST API JSON,
  the same as `GET /v1/files/:key/nodes?ids=:id`, exported inside Figma with
  `exportAsync({ format: 'JSON_REST_V1' })`. The payload is
  `{ document, components, componentSets, styles, variables }`, where
  `variables` maps every variable id the tree binds to its `name`,
  `collection`, `resolvedType` and `codeSyntax`. `figma-rest+geometry` adds
  `fillGeometry` and `strokeGeometry` to vector layers, as REST's
  `geometry=paths` does.
- `node-subtree`: the plugin's own reading, property by property.
- `assets`: the icons and images inside the node, with `format: "assets"` and
  the payload `{ type: "ASSETS", name, width, height, icons, images }`, where
  `name`, `width` and `height` are the node read's. The plugin walks the
  visible layers only.
  - An icon is the top-most layer whose visible subtree holds no text and no
    image or video fill, and which draws a path: a vector, boolean operation,
    star or polygon, or a frame, group, instance or component holding two or
    more shapes. A frame, instance or component with a visible fill, stroke or
    effect of its own is a box code draws, so the icons inside it are taken
    instead. Each icon is `exportAsync({ format: 'SVG_STRING' })`, the markup
    Figma's Copy as SVG gives, as `svg`, or as `svgBase64` when Figma only
    exports SVG bytes. It also has `{ id, name, type, width, height, path }`
    and, for an instance, `component` ("Set / Variant"). Icons whose markup is
    the same once SVG ids are numbered in order are sent once, with every layer
    that uses them in `layers: [{ id, name, path }]`.
  - An image is every visible `IMAGE` paint, once per `imageHash`, with its
    original file as `base64`, its pixel `width` and `height`, its
    `byteLength`, and in `layers` each layer that shows it, with its size,
    its place `x` and `y` from the top left of the node read,
    `scaleMode`, `imageTransform`, `scalingFactor`, `rotation`,
    `filters`, paint `opacity` and `cornerRadius`. A layer with more than
    one visible fill also has `fills`, every one of them bottom first in the
    REST API's paint shape without `boundVariables`, and `fillIndex`, the
    image's place among them. A frame placed on a page or in a section, a
    screen, also has `screen: true`. A `VIDEO` paint is listed with
    `kind: "VIDEO"` and no file.
  - `maxBytes` bounds the SVG and image data. An icon or image past it keeps
    its record with `truncated: true` and no data, and its layer ids are in
    `truncatedNodeIds`; reading one of those ids alone exports it. `maxNodes`
    bounds the walk, and the layers it never reached are in
    `truncatedNodeIds` too.
- `render+s<scale>[+jpg|+svg]`: the node exported as Figma's Export does, with
  `format: "render"` and the payload `{ type: "RENDER", name, format, width,
  height, scale, byteLength, base64 }`. The scale is clamped to 0.25–4. A PNG or
  JPG longer than 4096 px on its long side is exported 4096 px long instead, and
  `scale` says the scale used. `+svg` sends `svg` (or `svgBase64`) with
  text drawn as paths. A render larger than `maxBytes` has no data and
  `truncated: true`.
- `search`: the layers under the node whose name, or whose text for a text
  layer, holds `query`, ignoring case. The plugin reads only names, text, box
  and first fill, with no export, so a section of many screens takes seconds.
  It answers with `format: "search"` and the payload
  `{ query, matches, checked, more }`. Each match is
  `{ id, name, type, path, text?, x, y, width, height, fill? }`: `path` holds
  the names of the layers from the node read down to the match's parent,
  `text` is a text layer's characters cut to 300, `x` and `y` are relative
  to the parent, and `fill` is the first visible solid fill as `#RRGGBB`.
  `checked` counts the layers looked at, which `completeness.nodeCount`
  repeats. The plugin stops at 200 matches with `more: true`, or at the
  read's deadline with `completeness.stoppedBy: "time"`; both set
  `truncated`. `depth` and `includeHidden` apply; `maxNodes` and
  `maxBytes` do not.

A file link reads the document index whatever representation was asked for,
except `assets`, `render` and `search`, which are refused with `400 BAD_REQUEST`:
they need a node.

For `figma-rest`, the plugin first counts a subtree by walking its `children`
only, and exports it whole when it fits what is left of `maxNodes` (at most 5,000
nodes per export) and of `depth`. A layer that does not fit is marked
`partial: true`: its own box, layout, paint, effects and bound variables are read
directly, in the REST API's names, and its children are exported one by one.
Layers below `depth` become `{ id, name, type, truncated: true }`, text longer
than 100,000 characters is cut with its per-character styles (`textTruncated:
true`), and a layer Figma fails to export once others exported carries
`exportError`. When the first export fails, the plugin reads the whole node as
`node-subtree` instead and says why in `fallbackReason`.

For `node-subtree`, the plugin walks roughly 270–600 nodes a second, so 20,000
nodes take about 90 s, close to the 120 s `timeoutMs` ceiling. Both walks run in
slices of about 50 ms and hand control back to Figma between them, so Figma, the
panel and its heartbeats stay responsive during a long read. The plugin serves
one heavy read at a time, in the order they arrive (see the poll route).

Figma throttles timers while its window is hidden or minimized, to one a
second and then one a minute, so the plugin does not wait on a timer between
slices. Since 1.11.0 it posts `{ type: "bridge-yield", id }` to its panel and
goes on when the panel answers `bridge-yield-ack`, or when a `setTimeout(0)`
fires, whichever comes first. A REST, assets or search read reports
`timing.yields` (how many times it handed control back), `timing.yieldMs`
(the time it waited in all) and `timing.maxYieldMs` (the longest wait). A
large `yieldMs` means Figma kept the read waiting.

A URL `node-id` in dash form (`1-23`) is canonicalized to colon form (`1:23`).
A source with no node id asks for a lightweight document index rather than a
whole-file dump.

Options that change the payload also change the `representation` string, so they
are part of the cache key — a `depth: 12` read can never be served from a
`depth: 3` entry. Because hidden layers are included by default, only
`includeHidden: false` changes the key (`+visible-only`); `true` shares the
default entry. A `query` adds `+q` and the first 16 hex digits of the SHA-256
of the lowercased query, so each search has its own entry, and searches that
differ only in case share one.

When a limit cuts the payload, the plugin keeps the subtree in document order
and cuts what comes last. Every layer it cuts stays in its parent as a
placeholder `{ id, name, type, truncated: true }`, so the caller can read each
one with its id as `node-id`:

- layers below `depth`;
- the layers left once `maxNodes` is spent;
- over `maxBytes`, the trailing layers, deepest first, until the payload fits.
  A parent whose children are all placeholders becomes a placeholder itself.
  Only when the root holds nothing but placeholders does the plugin drop them,
  last first.

An older plugin stops at the first layer past `maxNodes` and drops byte-cut
layers without a placeholder. A node whose children were cut carries
`truncated: true`, and `completeness` describes what was returned: `nodeCount`
counts the node objects in the payload (placeholders included), `byteSize` is
its UTF-8 size, and `truncatedNodeIds` lists the ids of nodes whose content or
children were cut (for a document index, the entries that were dropped). A
listed node may itself have been removed by a later cut.

**Response `200 OK`:**

```json
{
  "fileKey": "abc123DEF456",
  "fileName": "Website",
  "nodeId": "1:23",
  "pageId": "0:1",
  "pageName": "Page 1",
  "source": "plugin",
  "fetchedAt": "2026-09-17T10:00:05.000Z",
  "freshness": "live",
  "verifiedFresh": true,
  "stale": false,
  "ageMs": 0,
  "truncated": false,
  "completeness": { "nodeCount": 142, "byteSize": 28416, "limitHit": false, "truncatedNodeIds": [] },
  "mode": "live",
  "representation": "figma-rest+d12+n5000",
  "sessionId": "s_9f2a…",
  "requestId": "r_41b0…",
  "cached": true,
  "format": "figma-rest",
  "timing": { "countMs": 12, "exportMs": 180, "totalMs": 240 },
  "payload": { }
}
```

`format`, `timing` and `fallbackReason` repeat what the plugin reported.
`pluginOutdated: true` says the plugin could not export `figma-rest`, so the
read used `node-subtree` (see the capabilities above).

#### Live mode

`mode: "live"` answers with the plugin's reading or with an error: read now, or
read earlier and confirmed unchanged by the plugin that read it (see
[Reuse](#reuse)). There is no cache fallback and no REST fallback. If no plugin
session is connected for that file, the read fails with
`409 NO_SESSION_FOR_FILE` and an actionable message — it does not quietly return
older data.

Concurrent identical reads are coalesced: the same file, node and
representation requested twice while one is in flight produces one plugin round
trip and two identical answers.

#### Reuse

A live read is answered from the cache, without the plugin reading, when all of
these hold:

- the cache holds a read of the same file, node and representation, made by the
  plugin session the read would go to now, at most five minutes ago;
- that session has the `edit-seq` capability, and the stored read recorded the
  edit count it began at;
- the plugin answers `edit-seq` within 2 s with that same count;
- the request did not pass `fresh: true`.

The response is then the stored read with `freshness: "live"`,
`verifiedFresh: true`, `reused: true`, `requestId: null`, the original
`fetchedAt`, and its age in `ageMs`. The plugin answers `edit-seq` at once, even
while it reads something else, so a reused read never waits in the plugin's
queue: any number of agents reading the same unchanged node are answered
together.

The plugin counts the edits Figma reports to it through `documentchange`. Figma
does not report every change that way, a change to a variable's value alone for
one, so a read reused within five minutes of such a change can miss it. Pass
`fresh: true` to read again.

#### Cached mode

`mode: "cached"` is an explicit opt-in to unverified data. A cached response
always reports `freshness: "unknown"`, `verifiedFresh: false` and `stale: true`,
regardless of how recently it was written or what the stored entry claimed.
`ageMs` tells you how old it is; it is not a freshness guarantee. With nothing
cached, the response is `404 NO_CACHED_DATA`.

#### The freshness envelope

Every `/bridge/read` response carries the same envelope — on a hit, on a miss
and on an error — so a caller never has to infer provenance from the absence of
a field:

| Field | Meaning |
|-------|---------|
| `fileKey`, `fileName`, `nodeId`, `pageId`, `pageName` | What was actually read |
| `source` | Where the data originally came from. `"plugin"` when a plugin produced it — **including when it is later replayed from cache** |
| `mode` | How *this* response was served: `"live"` or `"cached"` |
| `fetchedAt` | When the data was produced |
| `freshness` | `"live"` or `"unknown"` |
| `verifiedFresh` | `true` only when a live plugin reply produced this response, now or as a read the plugin confirmed unchanged (`reused: true`) |
| `stale` | "not verified against the live document", not "known out of date" |
| `ageMs` | Age of the entry, `0` for a read made now |
| `truncated` | Whether a limit cut the payload |
| `completeness` | `{ nodeCount, byteSize, limitHit, truncatedNodeIds }`, plus `stoppedBy: "time"` when the read stopped at its deadline |

> **Do not branch on `source` to decide whether a response is live.** A cached
> replay of plugin-produced data still reports `source: "plugin"`; only
> `mode`, `freshness`, `verifiedFresh` and `stale` are pinned per response.
> `verifiedFresh` is the field to test.

`verifiedFresh: true` is a positive assertion. It is written only when a live
plugin reply produced the entry, and the cache layer rejects any attempt to
store it without both `source: "plugin"` and a session id. It is never inferred
from a TTL.

---

### `GET /bridge/status`

Readiness and actionable setup errors. Never connection secrets.

```json
{
  "protocolVersion": "1.0",
  "host": { "serverVersion": "1.12.0", "pid": 35452, "startedAt": "2026-11-05T09:00:00.000Z" },
  "readiness": { "ready": true, "sessionCount": 1, "liveFileKeys": ["abc123DEF456"] },
  "sessions": [
    {
      "sessionId": "s_9f2a…",
      "fileKey": "abc123DEF456",
      "fileName": "Website",
      "pluginInstanceId": "plugin-7f3c",
      "registeredAt": "2026-09-17T10:00:00.000Z",
      "lastSeenAt": "2026-09-17T10:04:30.000Z",
      "pendingCount": 0,
      "alive": true
    }
  ],
  "pairing": { "pending": 0 },
  "cache": {
    "entryCount": 12,
    "byteSize": 402118,
    "files": [{ "fileKey": "abc123DEF456", "fileName": "Checkout", "entryCount": 12 }]
  },
  "setupHints": []
}
```

Session fields are copied through an explicit allowlist, so a secret cannot
reach this response even if the broker grows a new field. When nothing is
connected, `setupHints` explains what to do.

`host` names the process that owns the port. Since 1.12.0; a bridge from before
then leaves it out. The MCP server's `get_bridge_status` adds
`thisServerVersion`, and a setup hint when the owner is older than it.

---

### `POST /bridge/handoff`

A newer figma-bridge server asks the owner of the port to hand it over. Claude
Code does not restart a running MCP server when its plugin updates, so without
this the first session opened keeps serving the bridge with older code until it
closes.

```json
{ "version": "1.12.1" }
```

The route needs the token and refuses any request that carries an `Origin`
header (`403 FORBIDDEN_ORIGIN`), so neither a web page nor the plugin's iframe
can call it. The owner accepts only a version newer than its own:

- `202 { "accepted": true, "serverVersion": "1.12.0" }`. Right after the answer,
  the owner stops listening, fails the reads it holds with `BRIDGE_HANDOFF`,
  and carries on as a client of the new owner.
- `409 HANDOFF_REFUSED` for the same version or an older one.

The new owner binds the port and, for its first 30 s, a live read for a file
with no session waits for the plugin to register again, up to 20 s and within
its `timeoutMs`, instead of failing with `NO_SESSION_FOR_FILE`. The plugin
notices the closed connection and registers again on its own.

---

### Pairing

How the Figma plugin obtains the bridge token without anyone copying it. The
plugin asks to pair and shows the 6-digit code it gets back. Someone who already
holds the token approves that code (`approve_figma_pairing` in an MCP client, or
`figma-bridge pair <code>` in a terminal), and the plugin then collects the
token once.

Asking and collecting cannot require the token, so they rely on the code
instead. Anything can ask, including a web page through a sandboxed iframe whose
origin is the same `null` as the plugin's, which is why nothing is handed out
before a person approves the code they see in Figma. A code is shown only to its
requester: never in a log line, and never in `GET /bridge/status`, which reports
only how many pairings are waiting.

#### `POST /bridge/pair`

No credentials. A request whose `Origin` header is outside the allowlist gets
`403 FORBIDDEN_ORIGIN`, and one with an unknown field or a name over its limit
gets `400 BAD_REQUEST`.

```json
{ "clientName": "Figma Design Bridge plugin", "fileName": "Website" }
```

Both fields are optional (`clientName` up to 60 characters, `fileName` up to
200); the approver sees them.

**Response `201 Created`:**

```json
{
  "pairingId": "9f2a…",
  "pairingSecret": "41b0…",
  "code": "482913",
  "expiresAt": "2026-09-17T10:02:00.000Z",
  "protocolVersion": "1.0"
}
```

The code expires after two minutes. At most three pairings wait at once and at
most ten may be requested per minute; beyond that the answer is
`429 PAIRING_LIMIT`.

#### `GET /bridge/pair/:id`

Requires the pairing secret in the `X-Pairing-Secret` header. Poll it until the
code is approved or expires.

| Answer | Meaning |
|--------|---------|
| `200 { "status": "pending", "expiresAt": "…" }` | Not approved yet |
| `200 { "status": "approved", "token": "…", "protocolVersion": "1.0" }` | Approved: the bridge token, handed out exactly once |
| `410 PAIRING_EXPIRED` | The code expired before anyone approved it |
| `404 PAIRING_NOT_FOUND` | Unknown pairing, or one already collected |
| `403 FORBIDDEN_ORIGIN` | The request came from a browser origin outside the allowlist |
| `401 UNAUTHORIZED` | Missing or wrong pairing secret |

#### `POST /bridge/pair/approve`

Requires the bridge token. Spaces and dashes in the code are ignored.

```json
{ "code": "482913" }
```

**Response `200 OK`:**

```json
{ "approved": true, "clientName": "Figma Design Bridge plugin", "fileName": "Website" }
```

`404 PAIRING_NOT_FOUND` when no pairing is waiting with that code (expired,
mistyped or already approved); `400 BAD_REQUEST` when the code is not six digits.

---

## Error codes

Errors are distinguishable by design: an agent can tell "plugin offline" from
"node deleted" from "timed out" without parsing prose.

| Code | Status | Meaning |
|------|--------|---------|
| `FORBIDDEN_HOST` | 403 | The `Host` header was not a loopback host |
| `FORBIDDEN_ORIGIN` | 403 | A browser origin outside the allowlist asked to pair |
| `BAD_REQUEST` | 400 | Schema violation or unknown field |
| `INVALID_JSON` | 400 | Body was not valid JSON |
| `INVALID_SOURCE` | 400 | Source was not a resolvable Figma URL or file key |
| `UNAUTHORIZED` | 401 | Missing/invalid bridge token or session secret |
| `FILE_MISMATCH` | 403 | A session tried to act on another file |
| `NODE_NOT_FOUND` | 404 | The plugin could not find that node in that file |
| `NO_CACHED_DATA` | 404 | `mode: "cached"` with nothing cached |
| `PAIRING_NOT_FOUND` | 404 | No pairing is waiting with that code or id |
| `SESSION_NOT_FOUND` | 404 | The session is no longer registered |
| `NO_SESSION_FOR_FILE` | 409 | No plugin session is connected for that file |
| `PLUGIN_OUTDATED` | 409 | The plugin session for that file lacks the capability the representation needs; reopening Design Bridge in Figma loads the current plugin |
| `PAIRING_EXPIRED` | 410 | The pairing code expired before it was approved |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded the route's limit: 2,000,000 bytes, or 51,000,000 for a plugin reply |
| `PAIRING_LIMIT` | 429 | Too many pairings waiting or requested |
| `QUEUE_FULL` | 429 | That session's queue is at its limit |
| `TOO_MANY_PENDING` | 429 | The bridge-wide pending limit was reached |
| `INTERNAL_ERROR` | 500 | Unmapped failure |
| `FILE_MISMATCH` | 502 | A result claimed a different file and was discarded |
| `UPSTREAM_INVALID` | 502 | The plugin returned an unusable result |
| `HANDOFF_REFUSED` | 409 | `/bridge/handoff` asked for a version that is not newer than the owner |
| `SESSION_LOST` | 503 | The answering session went away mid-request |
| `BRIDGE_HANDOFF` | 503 | The bridge handed its port to a newer server before the read finished. Retry: the new owner serves it |
| `CANCELLED` | — | The caller closed its connection before the read was handed out; the read is dropped. Never sent, since nobody is left to read it |
| `TIMEOUT` | 504 | The plugin did not answer within `timeoutMs`, or the read waited past `timeoutMs` + `queueWaitMs` for its lane. The message says how many reads of that lane were ahead of it |

An error body is **flat**: `error` is the human-readable message string and
`code` is the machine-readable code. They are siblings, not nested.

```json
{
  "error": "No Figma plugin session is connected for file abc123DEF456. Open that file in Figma and run Plugins → Development → Design Bridge (press Pair with bridge the first time), then retry. Pass mode \"cached\" to read explicitly unverified data instead.",
  "code": "NO_SESSION_FOR_FILE"
}
```

Branch on `code`, never on the text of `error` — the wording is meant for a
human and may change.

Errors raised on `/bridge/read` additionally carry the full read envelope, so a
failed read still tells you which file and node it was about:

```json
{
  "fileKey": "abc123DEF456",
  "fileName": null,
  "nodeId": "1:23",
  "pageId": null,
  "pageName": null,
  "source": null,
  "fetchedAt": null,
  "freshness": "unknown",
  "verifiedFresh": false,
  "stale": true,
  "truncated": false,
  "completeness": null,
  "ageMs": null,
  "mode": "live",
  "representation": "node-subtree",
  "error": "No Figma plugin session is connected for file abc123DEF456. …",
  "code": "NO_SESSION_FOR_FILE"
}
```

---

## Cache layout

Entries are keyed by validated file key + canonical node id + representation.
The key is hashed with SHA-256 and stored as `<64 hex>.json` inside the data
directory, so no Figma-supplied string ever reaches the filesystem path. Writes
go to a temporary file and are moved into place with `rename`, so a crash
mid-write cannot leave a half-parsed entry; a rename Windows refuses for a
moment is retried.

Retention is bounded by two limits: 500 entries and 200 MB
(`FIGMA_BRIDGE_CACHE_MAX_BYTES`, or `cacheMaxBytes` in `server/config.json`).
After each write the oldest entries are removed until both hold — entries left
by an earlier process first, by file modification time, then this process's
writes in write order. The entry just written is always kept, even when it alone
is over the budget. Counting, eviction, invalidation and `stats` work from an
in-process index and never parse cached payloads; the index is built once per
process, on first use, from the first 64 KB of each file.

Caches for different files, pages and nodes are independent. Reading node B
never replaces node A's entry (only the retention limits remove entries), and
never switches another MCP client's file.

---

## Daemon startup

`server/bridge/daemon.js` exports `createDaemon`, `startOrReuse`, `probe` and
`PROTOCOL_VERSION`.

`startOrReuse` never assumes a listener on the configured port belongs to this
project. It probes `GET /bridge/health` first and only reuses the listener when
the service name matches **and** the protocol major version is compatible.
A listener that accepts the connection but does not answer in time is probed
twice more with a doubled timeout, then reported as `BRIDGE_BUSY`: most likely a
bridge busy with a large read. Anything else — a foreign service, an
incompatible version, an unreadable response — is reported as `PORT_OCCUPIED`
with instructions to stop that process or pick another via `FIGMA_BRIDGE_PORT`.
The daemon never kills a process it did not start. An MCP server whose start
failed keeps retrying every 10 seconds, so it takes the port over once it
frees up.

Concurrent MCP starts converge on a single daemon: a lost `EADDRINUSE` race
re-probes and reuses the winner.

Since 1.12.0 `startOrReuse` takes the server's own version. An owner that
reports an older `serverVersion` is asked to hand the port over (see
[`POST /bridge/handoff`](#post-bridgehandoff)); the caller then binds the port.
Every round probes again, so servers starting at once converge on the newest.
An owner from before 1.12.0 cannot hand over: it is reused, and the descriptor
says `outdatedHost: true`. It keeps the port until its session closes, and
`get_bridge_status` says so. An MCP server that is not the owner also checks
the owner's version every 10 s, so an older server that took the port while no
one held it is replaced.

---

## Known limitations

- **Accepted on Windows with Figma desktop only.** The plugin panel speaks
  this protocol and nothing else. Pairing and live node reads were accepted against a real
  Figma file on Windows (1.1.1 and 1.3.0); macOS and Linux run the automated
  suite only.
- **A first read can be slow.** Figma loads a page the first time a plugin
  reads it, which for a large page can take longer than the default 30 s
  `timeoutMs`. The read fails with `TIMEOUT`; retry with a larger `timeoutMs`
  (up to 120000) or a smaller `depth` or `maxNodes`.
- **Reads of one file take turns.** Figma runs a plugin on one thread, so the
  panel open on a file exports one node at a time. Searches and the document
  index run beside it, reads of different files run in parallel, and reused
  reads do not wait (see [Reuse](#reuse)). A read that waits its turn keeps its
  full `timeoutMs` when it passes `queueWaitMs`.
- **Reuse can miss an edit Figma does not report.** A change to a variable's
  value alone, for one, does not move the plugin's edit count. Pass
  `fresh: true` after such a change.
- **A lone plugin that dies abruptly is noticed late.** Closing the panel sends
  the session's `DELETE` with `keepalive`, so it normally ends at once, and a
  reopened panel takes the reads straight away (see the poll route). But a
  plugin that is killed, or whose Figma window hangs, with no other session for
  that file keeps its session until no heartbeat or poll has arrived for 90 s;
  reads sent to it in between fail with `TIMEOUT` instead of
  `NO_SESSION_FOR_FILE`. Reads already queued on a dead session before a new
  one registered time out too.
- **Figma can close the plugin during a large read.** The plugin VM has a
  memory ceiling; when a read goes over it, Figma's console shows
  `Plugin runtime aborted` and the panel closes without sending its `DELETE`.
  A read still waiting when the session expires fails with `SESSION_LOST`,
  saying the plugin stopped answering while it had that read. Reopen Design
  Bridge, then read one screen frame rather than a section of many screens, or
  pass a smaller `depth` or `maxNodes`, or `includeHidden: false`. Where the
  ceiling sits depends on the state of the Figma process: a 6,000-node read
  passed ten times in a fresh panel, while a default read crashed one that had
  been open for hours.
- **Edits reach the cache about a second late.** The panel keeps at most one
  invalidate request in flight and sends one follow-up about 1 s after it
  returns, so a burst of edits costs two requests. A `cached`-mode read in that
  window can return the pre-edit entry, which is why cached reads are always
  marked unverified.
- **Truncation does not say which limit was hit.** `completeness.limitHit` and
  `truncatedNodeIds` show that and where a result was cut, not whether
  `depth`, `maxNodes` or `maxBytes` did it. Only the read's deadline is named,
  with `completeness.stoppedBy: "time"`.
- **`networkAccess` pins the bridge to port 3456.** `plugin/manifest.json`
  declares `allowedDomains: ["none"]` with `http://localhost:3456` in
  `devAllowedDomains`. Moving the bridge with `FIGMA_BRIDGE_PORT` therefore
  requires editing both the manifest entry and `SERVER_URL` in
  `plugin/code.js`, then re-importing the plugin. The plugin's Bridge URL field
  has to stay on that declared origin too.
- **One process owns port 3456.** `server/index.js` and `server/mcp.mjs` both
  serve `/bridge/*` and the legacy routes. An MCP server that finds this bridge
  already running reuses it. That needs both to use the same data directory,
  because the token lives there, and by default they do: every launcher shares
  one directory per user. When it finds another program, or a bridge on a
  different data directory, it keeps serving the snapshot tools
  and its bridge tools report `PORT_OCCUPIED`, `BRIDGE_BUSY`, `NO_TOKEN` or
  `UNAUTHORIZED` with the fix, while it keeps trying to take the port over in
  the background. When the process that owns the port exits, a remaining MCP
  server takes the port over within about 10 seconds.
- **Token file permissions are best-effort on Windows.** `chmod 0o600` is
  honoured on macOS and Linux; on NTFS the inherited ACL wins and the mode is a
  no-op. The real protection there is that the token lives in the per-user
  data directory, outside any repository.
- **No screenshots.** This protocol returns structured design data, not images.
  A bounded PNG preview is deferred to phase 3.
