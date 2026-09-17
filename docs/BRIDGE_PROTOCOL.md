# Bridge Protocol (`/bridge/*`)

Status: **phase 1 implemented, not yet wired into `npm start`.** The modules in
`server/bridge/` are complete and tested in isolation. The Figma plugin and the
MCP adapter that consume them land in phase 2, so nothing below is reachable
from the currently running server yet. See
[the implementation plan](./PLAN_PLUGIN_ON_DEMAND_MCP.md) for the phase
breakdown.

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

Every route except `GET /bridge/health` requires the **bridge token**:

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

Request bodies are capped at 2,000,000 bytes (`413 PAYLOAD_TOO_LARGE`). Every
route rejects unknown fields rather than ignoring them.

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

---

### `GET /bridge/health`

Unauthenticated liveness and identity probe. Used by `startOrReuse` to decide
whether a listener already on the port is this bridge or a foreign process.

```json
{
  "status": "ok",
  "service": "figma-design-bridge",
  "protocolVersion": "1.0"
}
```

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
  "capabilities": ["read-node", "read-document-index"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `fileKey` | Yes | Figma file key, `[A-Za-z0-9_-]{1,128}` |
| `fileName` | No | Display name, max 200 characters |
| `pluginInstanceId` | Yes | Identifies this plugin instance |
| `capabilities` | No | Up to 16 short identifiers |

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
        "representation": "node-subtree",
        "options": {}
      }
    }
  ],
  "waitMs": 25000
}
```

`op` is `read-node` when the read named a node, or `read-document-index` when it
named a bare file URL.

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
    "payload": { }
  }
}
```

**Response `200 OK`:**

```json
{ "accepted": true, "reason": null }
```

A reply that arrives after its request already timed out, or that names a
request belonging to a different session, is **not** an error — it answers
`200 { "accepted": false, "reason": "…" }` so the plugin can discard the work and
move on. Such a reply never reaches a waiting caller and is never cached.

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

Invalidation is currently file-wide, which is conservative but correct.

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
  "options": { "depth": 12, "maxNodes": 5000 }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `source` | Yes | Figma URL or bare file key, max 2000 characters |
| `mode` | No | `"live"` (default) or `"cached"` |
| `timeoutMs` | No | 1–120000, default 30000 |
| `options` | No | See below |

| Option | Range |
|--------|-------|
| `representation` | short identifier, `[A-Za-z0-9_.+-]{1,40}` |
| `depth` | integer 0–50 |
| `maxNodes` | integer 1–200000 |
| `maxBytes` | integer 1–50000000 |
| `includeHidden` | boolean |

A URL `node-id` in dash form (`1-23`) is canonicalized to colon form (`1:23`).
A source with no node id asks for a lightweight document index rather than a
whole-file dump.

Options that change the payload also change the `representation` string, so they
are part of the cache key — a `depth: 12` read can never be served from a
`depth: 3` entry.

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
  "representation": "node-subtree+d12+n5000",
  "sessionId": "s_9f2a…",
  "requestId": "r_41b0…",
  "cached": true,
  "payload": { }
}
```

#### Live mode

`mode: "live"` is live or it is an error. There is no cache fallback and no REST
fallback. If no plugin session is connected for that file, the read fails with
`409 NO_SESSION_FOR_FILE` and an actionable message — it does not quietly return
older data.

Concurrent identical reads are coalesced: the same file, node and
representation requested twice while one is in flight produces one plugin round
trip and two identical answers.

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
| `verifiedFresh` | `true` only when a live plugin reply produced this response |
| `stale` | "not verified against the live document", not "known out of date" |
| `ageMs` | Age of the entry, `0` for a live read |
| `truncated` | Whether a limit cut the payload |
| `completeness` | `{ nodeCount, byteSize, limitHit, truncatedNodeIds }` |

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
  "cache": { "entries": 12, "bytes": 402118 },
  "setupHints": []
}
```

Session fields are copied through an explicit allowlist, so a secret cannot
reach this response even if the broker grows a new field. When nothing is
connected, `setupHints` explains what to do.

---

## Error codes

Errors are distinguishable by design: an agent can tell "plugin offline" from
"node deleted" from "timed out" without parsing prose.

| Code | Status | Meaning |
|------|--------|---------|
| `FORBIDDEN_HOST` | 403 | The `Host` header was not a loopback host |
| `BAD_REQUEST` | 400 | Schema violation or unknown field |
| `INVALID_JSON` | 400 | Body was not valid JSON |
| `INVALID_SOURCE` | 400 | Source was not a resolvable Figma URL or file key |
| `UNAUTHORIZED` | 401 | Missing/invalid bridge token or session secret |
| `FILE_MISMATCH` | 403 | A session tried to act on another file |
| `NODE_NOT_FOUND` | 404 | The plugin could not find that node in that file |
| `NO_CACHED_DATA` | 404 | `mode: "cached"` with nothing cached |
| `SESSION_NOT_FOUND` | 404 | The session is no longer registered |
| `NO_SESSION_FOR_FILE` | 409 | No plugin session is connected for that file |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded 2,000,000 bytes |
| `QUEUE_FULL` | 429 | That session's queue is at its limit |
| `TOO_MANY_PENDING` | 429 | The bridge-wide pending limit was reached |
| `INTERNAL_ERROR` | 500 | Unmapped failure |
| `FILE_MISMATCH` | 502 | A result claimed a different file and was discarded |
| `UPSTREAM_INVALID` | 502 | The plugin returned an unusable result |
| `SESSION_LOST` | 503 | The answering session went away mid-request |
| `TIMEOUT` | 504 | The plugin did not answer within `timeoutMs` |

An error body is **flat**: `error` is the human-readable message string and
`code` is the machine-readable code. They are siblings, not nested.

```json
{
  "error": "No Figma plugin session is connected for file abc123DEF456. Open that file in Figma, run Plugins → Design Bridge and press Start, then retry. Pass mode \"cached\" to read explicitly unverified data instead.",
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
mid-write cannot leave a half-parsed entry. Retention is bounded
(500 entries by default).

Caches for different files, pages and nodes are independent. Reading node B
never evicts node A, and never switches another MCP client's file.

---

## Daemon startup

`server/bridge/daemon.js` exports `createDaemon`, `startOrReuse`, `probe` and
`PROTOCOL_VERSION`.

`startOrReuse` never assumes a listener on the configured port belongs to this
project. It probes `GET /bridge/health` first and only reuses the listener when
the service name matches **and** the protocol major version is compatible.
Anything else — a foreign service, an incompatible version, an unreadable
response — is reported as an occupied port with instructions to stop that
process or pick another via `FIGMA_BRIDGE_PORT`. The daemon never kills a
process it did not start.

Concurrent MCP starts converge on a single daemon: a lost `EADDRINUSE` race
re-probes and reuses the winner.

---

## Known limitations

- **Not yet wired in.** `server/index.js` and `server/mcp.mjs` do not mount
  these routes yet; that is phase 2 work. The plugin still speaks to the legacy
  `POST /design` route.
- **`networkAccess` is absent from the manifest, but loopback does work.**
  Figma only enforces `networkAccess` for published plugins, not for one
  imported locally from a manifest, so `plugin/manifest.json` reaches
  `http://localhost:3456` today — verified by a real 935-node sync on
  2026-09-17. The field still has to be declared (with the loopback origin in
  `devAllowedDomains`) before the plugin could be submitted; see the README.
- **Port 3456 is shared, not contended.** `server/index.js` and `server/mcp.mjs`
  both try to bind it, but `mcp.mjs` now treats `EADDRINUSE` as a normal
  condition: it logs the clash, skips its HTTP ingest listener, and serves MCP
  over stdio from the same `DATA_DIR` the other process writes to. Running both
  at once is therefore safe. Making the MCP server a real client of the shared
  daemon is still phase 2 work.
- **Token file permissions are best-effort on Windows.** `chmod 0o600` is
  honoured on macOS and Linux; on NTFS the inherited ACL wins and the mode is a
  no-op. The real protection there is that the token lives in the git-ignored
  local data directory.
- **No screenshots.** This protocol returns structured design data, not images.
  A bounded PNG preview is deferred to phase 3.
