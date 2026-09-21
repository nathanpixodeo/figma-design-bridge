import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function bounded(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "figma-bridge-mcp-"));
const port = await freePort();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "server", "mcp.mjs")],
  cwd: root,
  env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(port) },
});
const client = new Client({ name: "integration-smoke", version: "1.0.0" });

try {
  await bounded(client.connect(transport), "MCP initialize");
  const listed = await bounded(client.listTools(), "tools/list");
  const tools = listed.tools || [];
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const expected = ["get_design_context", "get_bridge_status", "sync_figma_design", "get_design_summary", "get_design_tree", "get_design_texts", "get_design_colors", "search_design", "get_design_info"];
  assert.deepEqual([...byName.keys()].sort(), expected.sort());
  assert.deepEqual(byName.get("get_design_context").inputSchema.required, ["source"]);
  assert.deepEqual(byName.get("sync_figma_design").inputSchema.required, ["source"]);
  assert.deepEqual(byName.get("search_design").inputSchema.required, ["q"]);
  assert.equal(byName.get("get_design_context").inputSchema.properties.maxBytes.minimum, 1024);
  assert.equal(byName.get("get_design_summary").inputSchema.properties.maxBytes.minimum, 1024);

  const status = await bounded(client.callTool({ name: "get_bridge_status", arguments: {} }), "get_bridge_status");
  assert.equal(status.isError, undefined);
  assert.match(status.content?.[0]?.text || "", /ready|bridge|session|cache/i);
  console.log(`MCP stdio smoke passed (${tools.length} tools)`);
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedDataDir = path.resolve(dataDir);
  assert.ok(resolvedDataDir.startsWith(`${tempRoot}${path.sep}`));
  assert.match(path.basename(resolvedDataDir), /^figma-bridge-mcp-/);
  await fs.rm(resolvedDataDir, { recursive: true, force: true });
}
