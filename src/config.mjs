import 'dotenv/config';

function parseKeys(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];

  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch {}
  }

  return s.split(',').map(v => v.trim()).filter(Boolean);
}

// CLIENT_API_KEYS — keys MCP clients must provide to connect to this server.
// UPSTREAM_API_KEY — keys used to call the Amarpet API (round-robin).
// API_KEY          — legacy fallback for both if the specific vars are not set.
export const config = {
  port:           Number(process.env.PORT   || 3000),
  host:           process.env.HOST          || '0.0.0.0',
  mcpPath:        process.env.MCP_PATH      || '/mcp',
  upstreamBaseUrl: process.env.BASE_URL     || 'https://admin.amarpet.com/api/v1',
  clientApiKeys:  parseKeys(process.env.CLIENT_API_KEYS  ?? process.env.API_KEY),
  upstreamApiKeys: parseKeys(process.env.UPSTREAM_API_KEY ?? process.env.API_KEY),
};

if (config.clientApiKeys.length === 0) {
  console.warn('[config] WARNING: No CLIENT_API_KEYS set — MCP endpoint is open to everyone');
}
