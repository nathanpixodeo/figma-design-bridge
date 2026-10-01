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

const { createDaemon } = daemonModule;

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
