import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import createSnapshotStore from "./snapshot-store.js";
import daemonModule from "./bridge/daemon.js";
import dataDirModule from "./data-dir.js";
import tokenModule from "./bridge/token.js";
import toolPolicy from "./tool-policy.js";

const { createDaemon } = daemonModule;
const { rotateToken } = tokenModule;
const { describeDataDir, userDataDir } = dataDirModule;
const { READ_TOOLS } = toolPolicy;

// Every test runs the MCP server the way Claude Code does — a stdio child
// process — on a free port and a temporary data directory, so the bridge on
// 3456 and the real cache are never touched.

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(serverDir, "..");
const MCP_ENTRY = path.join(serverDir, "mcp.mjs");

function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-bridge-mcp-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function portFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function bridgeHealthy(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/bridge/health`)).ok;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("Condition not met in time");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function connectMcp(t, env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  const logs = [];
  transport.stderr.on("data", chunk => logs.push(String(chunk)));
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await client.connect(transport);
  client.serverLogs = () => logs.join("");
  t.after(() => client.close().catch(() => {}));
  return client;
}

// A raw stdio MCP server, for tests about what happens when stdin closes.
function spawnMcp(t, env, stdin = "pipe") {
  const child = spawn(process.execPath, [MCP_ENTRY], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: [stdin, "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(String(chunk)));
  child.stderr.resume();
  const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
  t.after(() => { if (child.exitCode === null) child.kill(); });
  return { child, exited, responses: () => output.join("").split("\n").filter(Boolean).map(line => JSON.parse(line)) };
}

function initialize(child) {
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-test", version: "1.0.0" } },
  }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}

function within(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve("still running"), ms))]);
}

function textOf(result) {
  return (result.content || []).map(item => item.text).join("\n");
}

function tokenIn(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, "bridge-token.json"), "utf8")).token;
}

test("the bridge an MCP server starts accepts the plugin's /design sync, and the tools see it", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));

  // Design payloads are large: Claude Code may show up to its ceiling inline.
  const { tools } = await client.listTools();
  const context = tools.find(tool => tool.name === "get_design_context");
  assert.equal(context._meta?.["anthropic/maxResultSizeChars"], 500000);
  for (const name of ["get_design_summary", "get_design_tree", "get_design_texts", "get_design_colors", "search_design"]) {
    assert.equal(tools.find(tool => tool.name === name)._meta?.["anthropic/maxResultSizeChars"], 500000, name);
  }

  // Codex runs a tool marked read-only without asking; pairing and a REST sync
  // must still ask.
  const hints = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
  for (const name of READ_TOOLS) {
    assert.deepEqual(hints[name], { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, name);
  }
  assert.equal(hints.approve_figma_pairing.readOnlyHint, false);
  assert.equal(hints.approve_figma_pairing.destructiveHint, true);
  assert.equal(hints.sync_figma_design.readOnlyHint, false);
  assert.equal(hints.sync_figma_design.openWorldHint, true);
  assert.equal(tools.length, READ_TOOLS.length + 2);

  const anonymous = await fetch(`http://127.0.0.1:${port}/design`);
  assert.equal(anonymous.status, 401);

  const synced = await fetch(`http://127.0.0.1:${port}/design`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenIn(dataDir)}` },
    body: JSON.stringify({ pageName: "Checkout", nodes: [{ id: "1:1", name: "Pay", type: "FRAME" }], nodeCount: 1 }),
  });
  assert.equal(synced.status, 200);

  const info = await client.callTool({ name: "get_design_info", arguments: {} });
  assert.equal(info.isError, undefined, textOf(info));
  assert.match(textOf(info), /\*\*Page:\*\* Checkout/);
});

test("approve_figma_pairing hands the bridge token to the plugin showing that code", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));

  // What the plugin does when the user presses "Pair with bridge".
  const asked = await (await fetch(`http://127.0.0.1:${port}/bridge/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "null" },
    body: JSON.stringify({ clientName: "Figma Design Bridge plugin", fileName: "Checkout" }),
  })).json();

  const status = await client.callTool({ name: "get_bridge_status", arguments: {} });
  assert.match(textOf(status), /"pending": 1/);
  assert.equal(textOf(status).includes(asked.code), false);

  const approved = await client.callTool({ name: "approve_figma_pairing", arguments: { code: asked.code } });
  assert.equal(approved.isError, undefined, textOf(approved));
  assert.match(textOf(approved), /Paired the Figma plugin for "Checkout"/);

  const collected = await (await fetch(`http://127.0.0.1:${port}/bridge/pair/${asked.pairingId}`, {
    headers: { "x-pairing-secret": asked.pairingSecret },
  })).json();
  assert.equal(collected.status, "approved");
  assert.equal(collected.token, tokenIn(dataDir));

  const unknown = await client.callTool({ name: "approve_figma_pairing", arguments: { code: asked.code } });
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /PAIRING_NOT_FOUND/);
});

test("snapshot tools pick up a sync another process wrote, without a restart", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  // Stands in for `npm start` writing into the same data directory.
  const otherProcess = createSnapshotStore({ dataDir });

  otherProcess.save({ pageName: "First sync", nodes: [], nodeCount: 0 });
  assert.match(textOf(await client.callTool({ name: "get_design_info", arguments: {} })), /First sync/);

  otherProcess.save({ pageName: "Second sync", nodes: [], nodeCount: 0 });
  assert.match(textOf(await client.callTool({ name: "get_design_info", arguments: {} })), /Second sync/);
});

test("a port held by another program does not stop the MCP server", async t => {
  const dataDir = tempDataDir(t);
  createSnapshotStore({ dataDir }).save({ pageName: "Cached page", nodes: [], nodeCount: 0 });
  const foreign = http.createServer((req, res) => res.end("not the bridge"));
  await new Promise(resolve => foreign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => {
    foreign.closeAllConnections();
    foreign.close(() => resolve());
  }));

  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(foreign.address().port) });

  const status = await client.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(status.isError, true);
  assert.match(textOf(status), /PORT_OCCUPIED/);

  const info = await client.callTool({ name: "get_design_info", arguments: {} });
  assert.equal(info.isError, undefined, textOf(info));
  assert.match(textOf(info), /Cached page/);
});

test("a bridge running on another data directory is reported with the fix, not a crash", async t => {
  const ownerDir = tempDataDir(t);
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const owner = await createDaemon({ port, dataDir: ownerDir, log: () => {} });
  t.after(() => owner.close());

  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });

  const status = await client.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(status.isError, true);
  assert.match(textOf(status), /NO_TOKEN/);
  assert.match(textOf(status), /FIGMA_BRIDGE_DATA_DIR/);
});

test("when the MCP server that owns the bridge exits, another one takes the port over without a tool call", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const env = { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) };

  const owner = await connectMcp(t, env);
  await waitFor(() => bridgeHealthy(port));
  const second = await connectMcp(t, env);
  const before = await second.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(before.isError, undefined, textOf(before));
  assert.doesNotMatch(second.serverLogs(), /bridge daemon listening/);

  await owner.close();
  // Only the second server's own daemon logs this, and only after taking over.
  await waitFor(() => /bridge daemon listening/.test(second.serverLogs()), 25_000);
  assert.equal(await bridgeHealthy(port), true);

  const after = await second.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(after.isError, undefined, textOf(after));
});

test("when its client closes stdin, the MCP server answers calls in flight, exits and releases the port", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const mcp = spawnMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  initialize(mcp.child);
  await waitFor(() => bridgeHealthy(port));

  mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_bridge_status", arguments: {} } }) + "\n");
  mcp.child.stdin.end();

  assert.equal(await within(mcp.exited, 8000), 0);
  const answered = mcp.responses().map(response => response.id);
  assert.deepEqual(answered, [1, 2]);
  assert.equal(await bridgeHealthy(port), false);
});

test("an MCP server started with no client keeps hosting the bridge", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  // stdin is the null device: closed before any client could connect.
  const mcp = spawnMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) }, "ignore");
  await waitFor(() => bridgeHealthy(port));

  assert.equal(await within(mcp.exited, 1500), "still running");
  assert.equal(await bridgeHealthy(port), true);
});

test("a read waits as long as timeoutMs asks, and a timeout says what to try next", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));

  const { version } = JSON.parse(fs.readFileSync(path.join(serverDir, "package.json"), "utf8"));
  assert.equal(client.getServerVersion().version, version);
  const { tools } = await client.listTools();
  assert.equal(tools.find(tool => tool.name === "get_design_context").inputSchema.properties.timeoutMs.maximum, 120000);
  // The schemas advertise what the plugin can serve, not more.
  for (const tool of tools.filter(t => t.inputSchema.properties?.maxNodes)) {
    assert.equal(tool.inputSchema.properties.maxNodes.maximum, 20000, tool.name);
    assert.equal(tool.inputSchema.properties.maxBytes.maximum, 10000000, tool.name);
  }

  // A plugin session that never answers.
  const registered = await fetch(`http://127.0.0.1:${port}/bridge/session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenIn(dataDir)}` },
    body: JSON.stringify({ fileKey: "SilentFileKey1", fileName: "Silent", pluginInstanceId: "silent-plugin" }),
  });
  assert.equal(registered.status, 201);

  const started = Date.now();
  const read = await client.callTool({
    name: "get_design_context",
    arguments: { source: "https://www.figma.com/design/SilentFileKey1/Silent?node-id=1-2", timeoutMs: 1500 },
  });
  const waited = Date.now() - started;
  assert.equal(read.isError, true);
  assert.match(textOf(read), /TIMEOUT: Request timed out waiting for a plugin reply\. Figma loads .*larger timeoutMs/);
  assert.ok(waited >= 1400 && waited < 10_000, `waited ${waited} ms instead of about 1500`);
});

test("a read whose plugin goes away says how to retry with a smaller read", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));

  // A panel that takes the read and then closes, as Figma does to a plugin
  // that runs out of memory.
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${tokenIn(dataDir)}`, "content-type": "application/json" };
  const session = await (await fetch(`${base}/bridge/session`, {
    method: "POST", headers: auth, body: JSON.stringify({ fileKey: "ClosingFile1", fileName: "Closing", pluginInstanceId: "closing-plugin" }),
  })).json();
  const headers = { ...auth, "x-session-secret": session.sessionSecret };
  const read = client.callTool({
    name: "get_design_summary",
    arguments: { source: "https://www.figma.com/design/ClosingFile1/Closing?node-id=1-2", timeoutMs: 10000 },
  });
  const polled = await (await fetch(`${base}/bridge/session/${session.sessionId}/poll?waitMs=5000`, { headers })).json();
  assert.equal(polled.requests.length, 1);
  await fetch(`${base}/bridge/session/${session.sessionId}?reason=plugin-close`, { method: "DELETE", headers });

  const result = await read;
  assert.equal(result.isError, true);
  assert.match(textOf(result), /SESSION_LOST: .*reopen Design Bridge.*one screen frame.*includeHidden: false\.$/s);
});

// Plays the Figma plugin: registers a session for fileKey and answers every
// read with answer(request) until the test ends. Without capabilities it plays
// a plugin older than 1.5.0.
async function fakePlugin(t, port, dataDir, fileKey, answer, capabilities) {
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${tokenIn(dataDir)}`, "content-type": "application/json" };
  const session = await (await fetch(`${base}/bridge/session`, {
    method: "POST", headers: auth, body: JSON.stringify({ fileKey, fileName: "Checkout", pluginInstanceId: `fake-${fileKey}`, capabilities }),
  })).json();
  const headers = { ...auth, "x-session-secret": session.sessionSecret };
  let running = true;
  t.after(() => { running = false; });
  (async () => {
    while (running) {
      let polled;
      try {
        polled = await (await fetch(`${base}/bridge/session/${session.sessionId}/poll?waitMs=1000`, { headers })).json();
      } catch {
        return;
      }
      for (const request of polled.requests || []) {
        await fetch(`${base}/bridge/session/${session.sessionId}/reply`, {
          method: "POST", headers, body: JSON.stringify({ requestId: request.requestId, ok: true, result: answer(request) }),
        }).catch(() => {});
      }
    }
  })();
}

test("texts, colors and search refuse a file link, and a truncated read says so", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));
  await fakePlugin(t, port, dataDir, "CheckoutFile1", request => (request.op === "read-node"
    ? {
      fileKey: "CheckoutFile1", fileName: "Checkout", nodeId: request.params.nodeId, pageId: "0:1", pageName: "Home",
      completeness: { nodeCount: 2, byteSize: 200, limitHit: true, truncatedNodeIds: ["1:9"] },
      payload: {
        id: request.params.nodeId, name: "Pay", type: "FRAME",
        children: [{ id: "1:3", name: "Label", type: "TEXT", characters: "Pay now", fills: [{ type: "SOLID", color: "#FF0000" }] }],
      },
    }
    : {
      fileKey: "CheckoutFile1", fileName: "Checkout",
      completeness: { nodeCount: 2, byteSize: 100, limitHit: false, truncatedNodeIds: [] },
      payload: { pages: [{ id: "0:1", name: "Home", type: "PAGE", children: [{ id: "1:2", name: "Pay", type: "FRAME" }] }] },
    }));

  // A file link only reaches the document index, which has no text or colors:
  // "No text nodes found" would be a confident wrong answer.
  const fileLink = "https://www.figma.com/design/CheckoutFile1/Checkout";
  for (const [name, extra] of [["get_design_texts", {}], ["get_design_colors", {}], ["search_design", { q: "Pay" }]]) {
    const refused = await client.callTool({ name, arguments: { source: fileLink, ...extra } });
    assert.equal(refused.isError, true, `${name} answered from the document index`);
    assert.match(textOf(refused), /node-id/);
  }
  const tree = await client.callTool({ name: "get_design_tree", arguments: { source: fileLink } });
  assert.match(textOf(tree), /This is the document index/);

  const texts = await client.callTool({ name: "get_design_texts", arguments: { source: `${fileLink}?node-id=1-2` } });
  assert.equal(texts.isError, undefined, textOf(texts));
  assert.match(textOf(texts), /^> Source: Checkout, node 1:2, live read at /);
  assert.match(textOf(texts), /Pay now/);
  assert.match(textOf(texts), /truncated \(1 subtree\(s\) cut\)/);
  // This plugin registered no capabilities, as one older than 1.5.0 does.
  assert.match(textOf(texts), /too old to export Figma's REST JSON.*reopen Design Bridge/);
  const context = JSON.parse(textOf(await client.callTool({ name: "get_design_context", arguments: { source: `${fileLink}?node-id=1-2` } })));
  assert.equal(context.pluginOutdated, true);
  assert.equal(context.representation, "node-subtree+d50");
  assert.match(context.notes.join(" "), /reopen Design Bridge/);
});

test("a node is read as Figma's REST JSON, and the same read is reused until the plugin reports an edit", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));
  const reads = [];
  let editSeq = 4;
  await fakePlugin(t, port, dataDir, "RestFile1", request => {
    if (request.op === "edit-seq") return { fileKey: "RestFile1", editSeq };
    reads.push(request.params.representation);
    return {
      fileKey: "RestFile1", fileName: "Checkout", nodeId: request.params.nodeId, pageId: "0:1", pageName: "Home",
      format: "figma-rest", editSeq,
      completeness: { nodeCount: 2, byteSize: 400, limitHit: false, truncatedNodeIds: [] },
      payload: {
        document: {
          id: request.params.nodeId, name: "Card", type: "FRAME", rectangleCornerRadii: [12, 12, 0, 4],
          absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 200 },
          children: [{
            id: "1:3", name: "Title", type: "TEXT", characters: "Pay now",
            style: { fontFamily: "Inter", fontPostScriptName: "Inter-SemiBold", fontStyle: "Semi Bold", fontSize: 16 },
            fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
          }],
        },
        components: {}, componentSets: {}, styles: {}, variables: {},
      },
    };
  }, ["read-node", "read-document-index", "figma-rest", "edit-seq"]);

  const source = "https://www.figma.com/design/RestFile1/Checkout?node-id=1-2";
  const first = JSON.parse(textOf(await client.callTool({ name: "get_design_context", arguments: { source } })));
  assert.equal(first.format, "figma-rest");
  assert.deepEqual(first.payload.document.rectangleCornerRadii, [12, 12, 0, 4]);
  assert.equal(first.notes, undefined);

  // Another tool asking for the same node: the plugin only confirms no edit.
  const texts = await client.callTool({ name: "get_design_texts", arguments: { source } });
  assert.equal(texts.isError, undefined, textOf(texts));
  assert.match(textOf(texts), /reused: the plugin reported no edit since/);
  assert.match(textOf(texts), /\| Card > Title \| Pay now \| Inter \| 16 \|/);
  const colors = await client.callTool({ name: "get_design_colors", arguments: { source } });
  assert.match(textOf(colors), /\| #FF0000 \| 1 \| Title \|/);
  assert.deepEqual(reads, ["figma-rest+d50"]);

  editSeq = 5;
  await client.callTool({ name: "get_design_texts", arguments: { source } });
  await client.callTool({ name: "get_design_context", arguments: { source, fresh: true } });
  await client.callTool({ name: "get_design_context", arguments: { source, geometry: true } });
  assert.deepEqual(reads, ["figma-rest+d50", "figma-rest+d50", "figma-rest+d50", "figma-rest+geometry+d50"]);
});

test("a derived tool reads a cut node again whole, and every answer names what is still left out", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));
  const reads = [];
  await fakePlugin(t, port, dataDir, "SearchFile1", request => {
    if (request.op === "edit-seq") return { fileKey: "SearchFile1", editSeq: 1 };
    reads.push(request.params.representation);
    // Only a read up to the bridge's caps holds the whole frame.
    const whole = request.params.options?.maxBytes === 10000000;
    const events = { id: "1:3", name: "Events", type: "TEXT", characters: "Events" };
    const channels = whole
      ? { id: "1:9", name: "Channels", type: "FRAME", children: [{ id: "1:10", name: "Title", type: "TEXT", characters: "Chaînes" }] }
      : { id: "1:9", name: "Channels", type: "FRAME", truncated: true };
    return {
      fileKey: "SearchFile1", fileName: "Search", nodeId: request.params.nodeId, pageId: "0:1", pageName: "Home",
      format: "figma-rest", editSeq: 1,
      completeness: { nodeCount: whole ? 4 : 3, byteSize: 400, limitHit: !whole, truncatedNodeIds: whole ? [] : ["1:9"] },
      payload: {
        document: { id: request.params.nodeId, name: "Search", type: "FRAME", children: [events, channels] },
        components: {}, componentSets: {}, styles: {}, variables: {},
      },
    };
  }, ["read-node", "read-document-index", "figma-rest", "edit-seq"]);
  const source = "https://www.figma.com/design/SearchFile1/Search?node-id=1-2";

  const texts = textOf(await client.callTool({ name: "get_design_texts", arguments: { source } }));
  assert.match(texts, /\| Search > Channels > Title \| Chaînes \|/);
  assert.doesNotMatch(texts, /truncated/);
  assert.deepEqual(reads, ["figma-rest+d50", "figma-rest+d50+n20000+b10000000"]);

  // get_design_context keeps its limits and names the layer it left out.
  const context = JSON.parse(textOf(await client.callTool({ name: "get_design_context", arguments: { source } })));
  assert.equal(context.reused, true);
  assert.match(context.notes.join(" "), /1 layer\(s\) were left out, with everything inside them: "Channels" \(1:9\)\. Read each one with the same link and its id as node-id/);

  // A limit the caller sets is kept, and the answer says what it left out.
  const bounded = textOf(await client.callTool({ name: "get_design_texts", arguments: { source, maxBytes: 50000 } }));
  assert.match(bounded, /Events/);
  assert.doesNotMatch(bounded, /Chaînes/);
  assert.match(bounded, /"Channels" \(1:9\)/);
  assert.deepEqual(reads, ["figma-rest+d50", "figma-rest+d50+n20000+b10000000", "figma-rest+d50+b50000"]);
});

test("the MCP server that owns the bridge keeps working after the token is rotated", async t => {
  const dataDir = tempDataDir(t);
  const port = await freePort();
  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));
  const before = tokenIn(dataDir);

  rotateToken(dataDir);
  const status = await client.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(status.isError, undefined, textOf(status));
  const old = await fetch(`http://127.0.0.1:${port}/bridge/status`, { headers: { authorization: `Bearer ${before}` } });
  assert.equal(old.status, 401);
});

test("an MCP server that could not start the bridge takes the port once it frees up", async t => {
  const ownerDir = tempDataDir(t);
  const dataDir = tempDataDir(t);
  const port = await freePort();
  // A bridge on another data directory, such as an older version's, holds the port.
  const owner = await createDaemon({ port, dataDir: ownerDir, log: () => {} });
  let ownerClosed = false;
  t.after(() => (ownerClosed ? undefined : owner.close()));

  const client = await connectMcp(t, { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) });
  assert.match(textOf(await client.callTool({ name: "get_bridge_status", arguments: {} })), /NO_TOKEN/);

  await owner.close();
  ownerClosed = true;
  // No tool call: the Figma plugin needs a bridge before the agent asks again.
  await waitFor(() => /bridge daemon listening/.test(client.serverLogs()), 25_000);
  assert.equal(await bridgeHealthy(port), true);
});

// The per-user directory every launcher shares, redirected into a temporary one
// on every platform, with no data directory set anywhere.
function sharedDirSetup(t) {
  const home = tempDataDir(t);
  return {
    shared: userDataDir({ env: { LOCALAPPDATA: home }, homedir: home }),
    env: { LOCALAPPDATA: home, HOME: home, FIGMA_BRIDGE_DATA_DIR: "", FIGMA_BRIDGE_MIGRATE_FROM: "" },
  };
}

// The environment .claude-plugin/plugin.json gives the MCP server, with the
// plugin's own data directory filled in the way Claude Code does.
function pluginEnv(pluginData) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const env = {};
  for (const [key, value] of Object.entries(manifest.mcpServers.bridge.env || {})) {
    env[key] = value.replaceAll("${CLAUDE_PLUGIN_DATA}", pluginData);
  }
  return env;
}

const ownDataDir = describeDataDir({ env: {} }).source === "config" ? "server/config.json names its own dataDir" : false;

test("the plugin's MCP server carries the token and snapshots an earlier version kept over to the shared directory", { skip: ownDataDir }, async t => {
  const { shared, env } = sharedDirSetup(t);
  const pluginData = tempDataDir(t);
  fs.writeFileSync(path.join(pluginData, "bridge-token.json"), JSON.stringify({ token: "f".repeat(64), createdAt: new Date().toISOString() }));
  createSnapshotStore({ dataDir: pluginData }).save({ pageName: "Synced before 1.3.0", nodes: [], nodeCount: 0 });
  const port = await freePort();

  const client = await connectMcp(t, { ...env, ...pluginEnv(pluginData), FIGMA_BRIDGE_PORT: String(port) });
  await waitFor(() => bridgeHealthy(port));

  const info = textOf(await client.callTool({ name: "get_design_info", arguments: {} }));
  assert.match(info, /Synced before 1\.3\.0/);
  assert.ok(info.includes(`**Data dir:** ${shared}`), info);
  const status = await fetch(`http://127.0.0.1:${port}/bridge/status`, { headers: { authorization: `Bearer ${"f".repeat(64)}` } });
  assert.equal(status.status, 200, "the Figma plugin paired before the update has to stay paired");
});

test("npm start and the plugin's MCP server share one bridge with no data directory configured", { skip: ownDataDir }, async t => {
  const { shared, env } = sharedDirSetup(t);
  // Already set up by an earlier start, so nothing is migrated from server/data.
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "bridge-token.json"), JSON.stringify({ token: "9".repeat(64), createdAt: new Date().toISOString() }));
  const port = await freePort();

  const server = spawn(process.execPath, [path.join(serverDir, "index.js")], {
    cwd: repoRoot,
    env: { ...process.env, ...env, FIGMA_BRIDGE_PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.resume();
  t.after(() => { if (server.exitCode === null) server.kill(); });
  await waitFor(() => bridgeHealthy(port));

  const client = await connectMcp(t, { ...env, ...pluginEnv(tempDataDir(t)), FIGMA_BRIDGE_PORT: String(port) });
  const status = await client.callTool({ name: "get_bridge_status", arguments: {} });
  assert.equal(status.isError, undefined, textOf(status));
  assert.doesNotMatch(client.serverLogs(), /bridge daemon listening/);
});
