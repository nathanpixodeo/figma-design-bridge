#!/usr/bin/env node
import figmaApi from "./figma-api.js";

const { fetchFigmaDesign } = figmaApi;
const source = process.argv[2];

if (!source || source === "--help" || source === "-h") {
  console.error("Usage: npm run import:figma -- <figma-url-or-file-key>");
  console.error("Requires FIGMA_ACCESS_TOKEN and a running bridge server/MCP HTTP endpoint.");
  process.exit(source ? 0 : 1);
}

try {
  const design = await fetchFigmaDesign(source);
  const bridgeUrl = (process.env.FIGMA_BRIDGE_URL || "http://127.0.0.1:3456").replace(/\/$/, "");
  const response = await fetch(`${bridgeUrl}/design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(design),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Bridge returned HTTP ${response.status}`);

  console.log(`Imported "${design.pageName}" (${design.nodeCount} nodes) from Figma.`);
  console.log(`Bridge: ${bridgeUrl}`);
} catch (error) {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
}
