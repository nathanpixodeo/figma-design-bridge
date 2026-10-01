import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Usage: node integrations/mcp-live-probe.mjs <figma-url-or-file-key> [path/to/mcp.mjs]
// The older order, server path first, still works. The design to read is never
// built in, so no real file key ends up in the repository.
const args = process.argv.slice(2);
const serverArg = args.find(arg => /\.(?:mjs|js)$/i.test(arg));
const serverPath = serverArg || path.join(root, 'server', 'mcp.mjs');
const source = args.find(arg => arg !== serverArg) || process.env.FIGMA_BRIDGE_PROBE_SOURCE;
if (!source) {
  console.error('Usage: node integrations/mcp-live-probe.mjs <figma-url-or-file-key> [path/to/mcp.mjs]');
  console.error('Or set FIGMA_BRIDGE_PROBE_SOURCE. Open that file in Figma and connect the plugin first.');
  process.exit(1);
}
const client = new Client({ name: 'figma-bridge-live-probe', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: root, env: process.env });

function summarize(result) {
  const raw = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (result.isError) return { isError: true, message: raw.slice(0, 1800) };
  try {
    const payload = JSON.parse(raw);
    return { isError: false, source: payload.source, fileKey: payload.fileKey, nodeId: payload.nodeId, readiness: payload.readiness, sessions: payload.sessions, preview: raw.slice(0, 800) };
  } catch {
    return { isError: false, text: raw.slice(0, 1200) };
  }
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  console.log('MCP_TOOLS', JSON.stringify(listed.tools.map(tool => tool.name)));
  for (const [name, args] of [
    ['get_bridge_status', {}],
    ['get_design_context', { source, mode: 'live', maxBytes: 8192 }],
  ]) {
    try {
      const result = await client.callTool({ name, arguments: args });
      console.log('MCP_RESULT', name, JSON.stringify(summarize(result)));
    } catch (error) {
      console.log('MCP_EXCEPTION', name, String(error));
    }
  }
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
}
