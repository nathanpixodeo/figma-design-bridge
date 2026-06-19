#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import figmaApi from "./figma-api.js";

const { fetchFigmaDesign } = figmaApi;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.FIGMA_BRIDGE_PORT || "3456", 10);
const DATA_DIR = process.env.FIGMA_BRIDGE_DATA_DIR || path.join(__dirname, "data");
const MAX_SNAPSHOTS = parseInt(process.env.FIGMA_BRIDGE_MAX_SNAPSHOTS || "50", 10);
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

// ── HTTP server ────────────────────────────────────────────

function serve() {
  const srv = http.createServer((req, res) => {
    const send = (status, data, ct = "application/json") => {
      res.writeHead(status, { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end(ct === "application/json" ? JSON.stringify(data) + "\n" : data);
    };
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); res.end(); return; }
    if (req.method === "POST" && req.url === "/design") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const d = JSON.parse(body);
          if (!d.nodes || !d.pageName) return send(400, { error: 'Missing "nodes" or "pageName"' });
          currentDesign = d;
          saveSnapshot(d);
          log(`Design synced: "${d.pageName}" — ${d.nodeCount} nodes`);
          send(200, { message: `Synced ${d.nodeCount} nodes`, nodeCount: d.nodeCount });
        } catch { send(400, { error: "Invalid JSON" }); }
      });
      return;
    }
    if (req.method === "POST" && req.url === "/figma/import") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        try {
          const input = JSON.parse(body);
          const source = input.source || input.url || input.fileKey;
          if (!source) return send(400, { error: 'Missing "source" (Figma URL or file key)' });
          const design = await fetchFigmaDesign(source, { nodeIds: input.nodeIds });
          currentDesign = design;
          saveSnapshot(design);
          log(`Figma API import: "${design.pageName}" — ${design.nodeCount} nodes`);
          send(200, { message: `Imported ${design.nodeCount} nodes from Figma`, pageName: design.pageName, fileName: design.fileName, nodeCount: design.nodeCount, source: design.source });
        } catch (error) {
          log(`Figma API import failed: ${error.message}`);
          send(502, { error: error.message });
        }
      });
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      send(200, { status: "ok", port: PORT, hasDesign: currentDesign !== null, pageName: currentDesign?.pageName || null, nodeCount: currentDesign?.nodeCount || 0 });
      return;
    }
    send(404, { error: "Not found" });
  });
  srv.listen(PORT, () => log(`HTTP server on http://localhost:${PORT}`));
  return srv;
}

// ── MCP server ─────────────────────────────────────────────

async function startMCP() {
  const mcp = new Server(
    { name: "Figma Design Bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sync_figma_design",
        description: "Fetch a Figma file or selected node through the official Figma REST API, normalize it, cache it locally, and make it the current design. Requires FIGMA_ACCESS_TOKEN with file_content:read scope in the MCP server environment. Call only when the user asks to sync or refresh to avoid unnecessary API usage.",
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
        description: "Get a comprehensive markdown summary of the current Figma design — screens, layer tree, all text content, color palette, and structure statistics. Use this as the primary tool to understand a design.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_design_tree",
        description: "Get an ASCII tree visualization of every layer in the design showing type, name, dimensions, and colors.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_design_texts",
        description: "Extract all text content from the design with font, size, and layer path for each text node.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_design_colors",
        description: "Get the color palette — every unique color used in fills and strokes, grouped with usage count and example node names.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_design",
        description: "Search for nodes by name or text content (case-insensitive). Returns matching nodes with their full path, type, dimensions, and properties.",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search term (matches node names and text content)" },
          },
          required: ["q"],
        },
      },
      {
        name: "get_design_info",
        description: "Get basic info about the currently loaded design: page name, type, node count, and sync timestamp.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async req => {
    const { name, arguments: args } = req.params;

    const err = msg => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
    const ok = text => ({ content: [{ type: "text", text }] });

    if (!currentDesign && name !== "get_design_info" && name !== "sync_figma_design") {
      return err("No design data loaded. Call sync_figma_design with a Figma URL first.");
    }

    switch (name) {
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

      case "get_design_summary":
        return ok(summary(currentDesign));

      case "get_design_tree": {
        let tree = (currentDesign.pageName || "Design") + "\n";
        for (const n of currentDesign.nodes) tree += treeNode(n);
        return ok(tree);
      }

      case "get_design_texts": {
        const texts = getAllTexts(currentDesign.nodes);
        if (!texts.length) return ok("No text nodes found.");
        let r = `# Text Content (${texts.length} nodes)\n\n| Path | Text | Font | Size |\n|---|---|---|---|\n`;
        texts.forEach(t => { r += `| ${t.path.replace(/\|/g, "\\|")} | ${(t.characters || "").replace(/\|/g, "\\|")} | ${t.fontFamily || "-"} | ${t.fontSize || "-"} |\n`; });
        return ok(r);
      }

      case "get_design_colors": {
        const palette = getColors(currentDesign.nodes);
        const keys = Object.keys(palette);
        if (!keys.length) return ok("No solid colors found.");
        const sorted = keys.sort((a, b) => palette[b].length - palette[a].length);
        let r = `# Color Palette (${keys.length} unique)\n\n| Color | Count | Examples |\n|---|---|---|\n`;
        for (const color of sorted) { const ex = [...new Set(palette[color].map(u => u.node))].slice(0, 3).join(", "); r += `| ${color} | ${palette[color].length} | ${ex} |\n`; }
        return ok(r);
      }

      case "search_design": {
        const q = args?.q;
        if (!q) return err('Missing required parameter "q"');
        const ql = q.toLowerCase();
        const results = findNodes(currentDesign.nodes, n => (n.name && n.name.toLowerCase().includes(ql)) || (n.type === "TEXT" && n.characters && n.characters.toLowerCase().includes(ql)));
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
      }

      case "get_design_info":
        return ok(`**Page:** ${currentDesign?.pageName || "—"}\n**File:** ${currentDesign?.fileName || "—"}\n**Type:** ${currentDesign?.type || "—"}\n**Source:** ${currentDesign?.source || "legacy-plugin"}\n**Nodes:** ${currentDesign?.nodeCount ?? 0}\n**Synced at:** ${currentDesign?.syncedAt || currentDesign?.savedAt || "Never"}\n**Data dir:** ${DATA_DIR}`);

      default:
        return err(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log("MCP connected via stdio (ready for Claude Code)");
}

// ── Entry ──────────────────────────────────────────────────

process.on("SIGINT", () => { log("Shutting down..."); process.exit(0); });
process.on("SIGTERM", () => { log("Shutting down..."); process.exit(0); });

ensureDirs();
serve();
await startMCP();
