#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import figmaApi from "./figma-api.js";

const { fetchFigmaDesign } = figmaApi;
const require = createRequire(import.meta.url);
const { startOrReuse } = require("./bridge/daemon.js");
const { createClient } = require("./bridge/client.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fileConfig = {};
try {
  const configPath = path.join(__dirname, "config.json");
  if (fs.existsSync(configPath)) fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch { /* fall back to defaults */ }
const PORT = parseInt(process.env.FIGMA_BRIDGE_PORT || fileConfig.port || "3456", 10);
const HOST = process.env.FIGMA_BRIDGE_HOST || fileConfig.host || "127.0.0.1";
const DATA_DIR = process.env.FIGMA_BRIDGE_DATA_DIR || fileConfig.dataDir || path.join(__dirname, "data");
const MAX_SNAPSHOTS = parseInt(process.env.FIGMA_BRIDGE_MAX_SNAPSHOTS || fileConfig.maxSnapshots || "50", 10);
const snapsDir = path.join(DATA_DIR, "snapshots");
const latestPath = path.join(DATA_DIR, "latest.json");

function log(...args) {
  process.stderr.write(`[${new Date().toISOString()}] ${args.join(" ")}\n`);
}

// ── Snapshot store ─────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(snapsDir, { recursive: true });
}

function saveSnapshot(design) {
  ensureDirs();
  const now = new Date().toISOString().replace(/:/g, "-");
  const fp = path.join(snapsDir, `${now}.json`);
  const snap = { ...design, savedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(snap, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(snap, null, 2));
  try {
    const files = fs.readdirSync(snapsDir).filter(f => f.endsWith(".json")).sort();
    while (files.length > MAX_SNAPSHOTS) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(snapsDir, oldest));
    }
  } catch (e) { /* ignore */ }
  return fp;
}

function loadLatest() {
  try {
    if (fs.existsSync(latestPath)) {
      const d = JSON.parse(fs.readFileSync(latestPath, "utf8"));
      log(`Restored snapshot: "${d.pageName}" (${d.nodeCount} nodes)`);
      return d;
    }
  } catch (e) { log("No snapshot to restore:", e.message); }
  return null;
}

// ── Design analysis ────────────────────────────────────────

function walk(nodes, fn, acc = []) {
  for (const n of nodes) { fn(n, acc); if (n.children) walk(n.children, fn, [...acc, n]); }
}

function findNodes(nodes, pred, acc = []) {
  const r = [];
  for (const n of nodes) { if (pred(n, acc)) r.push({ node: n, path: [...acc] }); if (n.children) r.push(...findNodes(n.children, pred, [...acc, n])); }
  return r;
}

function getAllTexts(nodes) {
  const t = [];
  walk(nodes, (n, p) => { if (n.type === "TEXT" && n.characters) t.push({ path: [...p.map(x => x.name), n.name].join(" > "), id: n.id, name: n.name, characters: n.characters, fontSize: n.fontSize, fontFamily: n.fontName?.family || null, fontStyle: n.fontName?.style || null, color: n.fills?.[0]?.color || null }); });
  return t;
}

function getColors(nodes) {
  const c = {};
  walk(nodes, n => {
    const add = (p, prop) => { if (!p) return; for (const x of p) { if (x.type === "SOLID" && x.color) { if (!c[x.color]) c[x.color] = []; c[x.color].push({ node: n.name, prop }); } } };
    add(n.fills, "fill"); add(n.strokes, "stroke");
  });
  return c;
}

function treeNode(n, d = 1) {
  const indent = "  ".repeat(d);
  const parts = [n.type, n.name ? `"${n.name}"` : null].filter(Boolean);
  let label = parts.join(" ");
  if (n.width && n.height) label += ` [${n.width}x${n.height}]`;
  if (n.type === "TEXT" && n.characters) { const t = n.characters.length > 50 ? n.characters.slice(0, 47) + "..." : n.characters; label += ` "${t}"`; }
  if (n.fills?.[0]?.type === "SOLID") label += ` ${n.fills[0].color}`;
  if (n.layoutMode) label += ` [${n.layoutMode}]`;
  let r = `${indent}${label}\n`;
  if (n.children) n.children.forEach(c => r += treeNode(c, d + 1));
  return r;
}

function summary(data) {
  if (!data) return "No design data loaded yet. Call sync_figma_design with a Figma URL first.";
  const { pageName, nodes, type, nodeCount, savedAt } = data;
  const texts = getAllTexts(nodes);
  const palette = getColors(nodes);
  let md = `# Design Summary: ${pageName}\n\n`;
  if (type === "selection") md += `> Selection only (${data.selectionCount || nodes.length} node(s))\n\n`;
  if (savedAt) md += `> Synced at: ${savedAt}\n\n`;
  const frames = findNodes(nodes, n => (n.type === "FRAME" || n.type === "COMPONENT") && n.width && n.height);
  if (frames.length > 0) {
    md += "## Screens\n\n";
    for (const { node: f } of frames) {
      md += `- **${f.name || "Untitled"}** [${f.type}] — ${f.width}x${f.height}`;
      if (f.layoutMode) md += `, auto-layout: ${f.layoutMode}`;
      md += "\n";
    }
    md += "\n";
  }
  md += "## Layer Tree\n\n```\n" + pageName + "\n";
  for (const n of nodes) md += treeNode(n);
  md += "```\n\n";
  if (texts.length > 0) {
    md += "## Text Content\n\n| # | Path | Text | Font | Size |\n|---|---|---|---|---|\n";
    texts.slice(0, 100).forEach((t, i) => {
      const dt = t.characters.length > 80 ? t.characters.slice(0, 77) + "..." : t.characters;
      md += `| ${i + 1} | ${t.path.replace(/\|/g, "\\|")} | ${dt.replace(/\|/g, "\\|")} | ${t.fontFamily || "-"} | ${t.fontSize || "-"} |\n`;
    });
    if (texts.length > 100) md += `| ... | *${texts.length - 100} more* | | | |\n`;
    md += "\n";
  }
  if (Object.keys(palette).length > 0) {
    md += "## Color Palette\n\n| Color | Usage |\n|---|---|\n";
    const sorted = Object.entries(palette).sort((a, b) => b[1].length - a[1].length);
    for (const [color, usages] of sorted.slice(0, 30)) {
      const sample = [...new Set(usages.map(u => u.node))].slice(0, 5).join(", ");
      md += `| ${color} | ${sample} (${usages.length}x) |\n`;
    }
    md += "\n";
  }
  const comps = findNodes(nodes, n => n.type === "COMPONENT" || n.type === "COMPONENT_SET");
  const insts = findNodes(nodes, n => n.type === "INSTANCE");
  md += "## Structure\n\n";
  md += `- Total nodes: ${nodeCount || 0}\n- Components: ${comps.length}\n- Instances: ${insts.length}\n- Text nodes: ${texts.length}\n- Top-level frames: ${frames.length}\n`;
  return md;
}

// ── State ──────────────────────────────────────────────────

let currentDesign = loadLatest();
let bridgeDescriptor = null;
let bridgeClient = null;
let bridgeStartup = null;

// ── Shared bridge client ────────────────────────────────────

async function ensureBridge() {
  if (bridgeClient) return bridgeClient;
  if (!bridgeStartup) {
    bridgeStartup = startOrReuse({
      port: PORT,
      host: HOST,
      dataDir: DATA_DIR,
      log: (level, ...args) => log(`[bridge:${level}]`, ...args),
    }).then(descriptor => {
      if (!descriptor.token) {
        const error = new Error(`Bridge token is unavailable in ${DATA_DIR}. Run the bridge once to create pairing data.`);
        error.code = "NO_TOKEN";
        throw error;
      }
      bridgeDescriptor = descriptor;
      bridgeClient = createClient({ url: descriptor.url, token: descriptor.token });
      return bridgeClient;
    }).catch(error => {
      bridgeStartup = null;
      throw error;
    });
  }
  return bridgeStartup;
}

function readOptionsFromArgs(args = {}) {
  const options = {};
  for (const key of ["depth", "maxNodes", "maxBytes", "includeHidden", "representation"]) {
    if (args[key] !== undefined) options[key] = args[key];
  }
  return Object.keys(options).length ? options : undefined;
}

function bridgeResultToDesign(result) {
  const payload = result?.payload;
  const nodes = result?.nodeId
    ? (payload ? [payload] : [])
    : (Array.isArray(payload?.pages) ? payload.pages : []);
  return {
    fileName: result?.fileName || null,
    pageName: result?.pageName || result?.fileName || (result?.nodeId ? "Requested node" : "Document index"),
    type: result?.nodeId ? "node" : "document-index",
    source: "plugin",
    nodes,
    nodeCount: result?.completeness?.nodeCount ?? nodes.length,
    syncedAt: result?.fetchedAt || null,
    bridge: result,
  };
}

async function resolveDesign(args = {}) {
  if (args?.source) {
    const client = await ensureBridge();
    const result = await client.read({
      source: args.source,
      mode: args.mode || "live",
      timeoutMs: args.timeout_ms,
      options: readOptionsFromArgs(args),
    });
    return bridgeResultToDesign(result);
  }
  if (currentDesign) return currentDesign;
  const error = new Error('No design source provided. Pass "source" with a Figma URL/file key, or explicitly import a legacy REST snapshot first.');
  error.code = "NO_DESIGN_SOURCE";
  throw error;
}

const SOURCE_PROPERTIES = {
  source: { type: "string", description: "Figma URL or file key. When provided, this tool reads through the live plugin bridge instead of global legacy state." },
  mode: { type: "string", enum: ["live", "cached"], description: "Live by default. Cached mode is explicit opt-in to unverified stale data." },
  depth: { type: "integer", minimum: 0, maximum: 50 },
  maxNodes: { type: "integer", minimum: 1, maximum: 200000 },
  maxBytes: { type: "integer", minimum: 1, maximum: 50000000 },
  includeHidden: { type: "boolean" },
};

// ── MCP server ─────────────────────────────────────────────

async function startMCP() {
  const mcp = new Server(
    { name: "Figma Design Bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_design_context",
        description: "Read a Figma file or exact node through the connected Figma plugin. A node URL returns that node and subtree; a file URL returns a lightweight document index. Live mode never silently falls back to REST or stale cache.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string", description: "Figma design URL (including node-id when relevant) or a Figma file key" },
            mode: { type: "string", enum: ["live", "cached"], description: "Use live unless the user explicitly asks for cached/offline data." },
            depth: { type: "integer", minimum: 0, maximum: 50 },
            maxNodes: { type: "integer", minimum: 1, maximum: 200000 },
            maxBytes: { type: "integer", minimum: 1, maximum: 50000000 },
            includeHidden: { type: "boolean" },
          },
          required: ["source"],
        },
      },
      {
        name: "get_bridge_status",
        description: "Show whether the local bridge is ready, which Figma files have live plugin sessions, cache statistics, and actionable setup hints. Does not expose pairing secrets.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "sync_figma_design",
        description: "Explicitly fetch a Figma file or selected node through the official Figma REST API and save a legacy snapshot. Requires FIGMA_ACCESS_TOKEN. This is separate from the plugin-first route and is never used as an automatic fallback.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string", description: "Figma design URL (including node-id when relevant) or a Figma file key" },
            node_ids: { type: "array", items: { type: "string" }, description: "Optional Figma node IDs to fetch instead of the full file" },
          },
          required: ["source"],
        },
      },
      {
        name: "get_design_summary",
        description: "Get a markdown summary for an explicit Figma source through the live plugin bridge, or for the legacy imported snapshot when source is omitted.",
        inputSchema: { type: "object", properties: { ...SOURCE_PROPERTIES } },
      },
      {
        name: "get_design_tree",
        description: "Get an ASCII layer tree for an explicit Figma source or the legacy imported snapshot.",
        inputSchema: { type: "object", properties: { ...SOURCE_PROPERTIES } },
      },
      {
        name: "get_design_texts",
        description: "Extract text content from an explicit Figma source or the legacy imported snapshot.",
        inputSchema: { type: "object", properties: { ...SOURCE_PROPERTIES } },
      },
      {
        name: "get_design_colors",
        description: "Get solid fill/stroke colors from an explicit Figma source or the legacy imported snapshot.",
        inputSchema: { type: "object", properties: { ...SOURCE_PROPERTIES } },
      },
      {
        name: "search_design",
        description: "Search an explicit Figma source or the legacy imported snapshot by node name or text content.",
        inputSchema: {
          type: "object",
          properties: {
            ...SOURCE_PROPERTIES,
            q: { type: "string", description: "Search term (matches node names and text content)" },
          },
          required: ["q"],
        },
      },
      {
        name: "get_design_info",
        description: "Get basic info for an explicit Figma source or the legacy imported snapshot.",
        inputSchema: { type: "object", properties: { ...SOURCE_PROPERTIES } },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async req => {
    const { name, arguments: args } = req.params;

    const err = msg => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
    const ok = text => ({ content: [{ type: "text", text }] });

    switch (name) {
      case "get_design_context": {
        if (!args?.source) return err('Missing required parameter "source"');
        try {
          const client = await ensureBridge();
          const result = await client.read({
            source: args.source,
            mode: args.mode || "live",
            options: readOptionsFromArgs(args),
          });
          return ok(JSON.stringify(result, null, 2));
        } catch (error) {
          return err(`${error.code ? `${error.code}: ` : ""}${error.message}`);
        }
      }

      case "get_bridge_status": {
        try {
          const client = await ensureBridge();
          return ok(JSON.stringify(await client.status(), null, 2));
        } catch (error) {
          return err(`${error.code ? `${error.code}: ` : ""}${error.message}`);
        }
      }

      case "sync_figma_design": {
        const source = args?.source;
        if (!source) return err('Missing required parameter "source"');
        try {
          const design = await fetchFigmaDesign(source, { nodeIds: args?.node_ids });
          currentDesign = design;
          const filepath = saveSnapshot(design);
          return ok(`Imported **${design.pageName}** from Figma REST API.\n\n- File: ${design.fileName || design.pageName}\n- Nodes: ${design.nodeCount}\n- Source: ${design.source}\n- Snapshot: ${path.basename(filepath)}\n- Synced at: ${design.syncedAt}`);
        } catch (error) {
          return err(error.message);
        }
      }

      case "get_design_summary": {
        try { return ok(summary(await resolveDesign(args))); }
        catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      case "get_design_tree": {
        try {
          const design = await resolveDesign(args);
          let tree = (design.pageName || "Design") + "\n";
          for (const n of design.nodes || []) tree += treeNode(n);
          return ok(tree);
        } catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      case "get_design_texts": {
        try {
          const design = await resolveDesign(args);
          const texts = getAllTexts(design.nodes || []);
          if (!texts.length) return ok("No text nodes found.");
          let r = `# Text Content (${texts.length} nodes)\n\n| Path | Text | Font | Size |\n|---|---|---|---|\n`;
          texts.forEach(t => { r += `| ${t.path.replace(/\|/g, "\\|")} | ${(t.characters || "").replace(/\|/g, "\\|")} | ${t.fontFamily || "-"} | ${t.fontSize || "-"} |\n`; });
          return ok(r);
        } catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      case "get_design_colors": {
        try {
          const design = await resolveDesign(args);
          const palette = getColors(design.nodes || []);
          const keys = Object.keys(palette);
          if (!keys.length) return ok("No solid colors found.");
          const sorted = keys.sort((a, b) => palette[b].length - palette[a].length);
          let r = `# Color Palette (${keys.length} unique)\n\n| Color | Count | Examples |\n|---|---|---|\n`;
          for (const color of sorted) { const ex = [...new Set(palette[color].map(u => u.node))].slice(0, 3).join(", "); r += `| ${color} | ${palette[color].length} | ${ex} |\n`; }
          return ok(r);
        } catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      case "search_design": {
        const q = args?.q;
        if (!q) return err('Missing required parameter "q"');
        try {
          const design = await resolveDesign(args);
          const ql = q.toLowerCase();
          const results = findNodes(design.nodes || [], n => (n.name && n.name.toLowerCase().includes(ql)) || (n.type === "TEXT" && n.characters && n.characters.toLowerCase().includes(ql)));
          if (!results.length) return ok(`No results for "${q}".`);
          let r = `# Search: "${q}" (${results.length} matches)\n\n`;
          results.forEach((res, i) => {
            const p = [...res.path.map(x => x.name), res.node.name].join(" > ");
            r += `**${i + 1}. ${res.node.name}** (${res.node.type})\n- Path: ${p}\n`;
            if (res.node.characters) r += `- Text: "${res.node.characters}"\n`;
            if (res.node.width && res.node.height) r += `- Size: ${res.node.width}x${res.node.height}\n`;
            if (res.node.x !== undefined) r += `- Position: (${res.node.x}, ${res.node.y})\n`;
            if (res.node.fills?.[0]?.type === "SOLID") r += `- Fill: ${res.node.fills[0].color}\n`;
            r += "\n";
          });
          return ok(r);
        } catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      case "get_design_info": {
        try {
          const design = await resolveDesign(args);
          return ok(`**Page:** ${design?.pageName || "—"}\n**File:** ${design?.fileName || "—"}\n**Type:** ${design?.type || "—"}\n**Source:** ${design?.source || "legacy-plugin"}\n**Nodes:** ${design?.nodeCount ?? 0}\n**Synced at:** ${design?.syncedAt || design?.savedAt || "Never"}\n**Data dir:** ${DATA_DIR}`);
        } catch (error) { return err(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log("MCP connected via stdio (ready for Claude Code)");
}

// ── Entry ──────────────────────────────────────────────────

async function shutdown() {
  log("Shutting down...");
  try { if (bridgeDescriptor?.owned) await bridgeDescriptor.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

ensureDirs();
await ensureBridge();
await startMCP();
