#!/usr/bin/env node
import fs from "node:fs";
import figmaApi from "./figma-api.js";
import dataDirModule from "./data-dir.js";
import tokenModule from "./bridge/token.js";

const { fetchFigmaDesign } = figmaApi;
const { prepareDataDir } = dataDirModule;
const { readToken } = tokenModule;
const source = process.argv[2];

if (!source || source === "--help" || source === "-h") {
  console.error("Usage: npm run import:figma -- <figma-url-or-file-key>");
  console.error("Requires FIGMA_ACCESS_TOKEN and a running bridge server/MCP HTTP endpoint.");
  process.exit(source ? 0 : 1);
}

// The port the server listens on: FIGMA_BRIDGE_PORT, then server/config.json.
function resolvePort() {
  if (process.env.FIGMA_BRIDGE_PORT) return process.env.FIGMA_BRIDGE_PORT;
  try {
    const config = JSON.parse(fs.readFileSync(dataDirModule.DEFAULT_CONFIG_PATH, "utf8"));
    if (config.port) return String(config.port);
  } catch {
    // No config file, or an unreadable one: the default port.
  }
  return "3456";
}

// POST /design requires the bridge token. An explicit FIGMA_BRIDGE_TOKEN wins so
// that this can import into a bridge whose data directory is not readable here;
// otherwise the stored token is read from the same directory the server uses.
function resolveBridgeToken() {
  const fromEnv = process.env.FIGMA_BRIDGE_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const { dataDir } = prepareDataDir({ log: message => console.error(message) });
  const stored = readToken(dataDir);
  return stored ? stored.token : null;
}

try {
  const design = await fetchFigmaDesign(source);
  const bridgeUrl = (process.env.FIGMA_BRIDGE_URL || `http://127.0.0.1:${resolvePort()}`).replace(/\/$/, "");
  const bridgeToken = resolveBridgeToken();
  const headers = { "Content-Type": "application/json" };
  if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;

  const response = await fetch(`${bridgeUrl}/design`, {
    method: "POST",
    headers,
    body: JSON.stringify(design),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    throw new Error(
      "The bridge rejected the token. Run `npm run bridge:token` and either export " +
      "FIGMA_BRIDGE_TOKEN or point FIGMA_BRIDGE_DATA_DIR at the directory the server uses."
    );
  }
  if (!response.ok) throw new Error(result.error || `Bridge returned HTTP ${response.status}`);

  console.log(`Imported "${design.pageName}" (${design.nodeCount} nodes) from Figma.`);
  console.log(`Bridge: ${bridgeUrl}`);
} catch (error) {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
}
