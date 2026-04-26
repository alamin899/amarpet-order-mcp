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

export const config = {
  port:            Number(process.env.PORT    || 3000),
  host:            process.env.HOST           || '0.0.0.0',
  mcpPath:         process.env.MCP_PATH       || '/mcp',
  upstreamBaseUrl: process.env.BASE_URL       || 'https://admin.amarpet.com/api/v1',
  upstreamApiKeys: parseKeys(process.env.UPSTREAM_API_KEY ?? process.env.API_KEY),
};
