import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const PORT   = Number(process.env.PORT   || 3000);
const HOST   = process.env.HOST          || '0.0.0.0';
const BASE_URL = process.env.BASE_URL    || 'https://admin.amarpet.com/api/v1';
const MCP_PATH = process.env.MCP_PATH   || '/mcp';
/**
 * Upstream Amarpet API key(s) used when the MCP tool calls the upstream API.
 * Supports:
 *  - single string:      API_KEY=abc
 *  - comma-separated:    API_KEY=abc,def
 *  - JSON array string:  API_KEY='["abc","def"]'
 */
function parseApiKeys(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];

  // Try JSON array first.
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated / single value
    }
  }

  // Comma-separated fallback.
  if (s.includes(',')) {
    return s.split(',').map((v) => v.trim()).filter(Boolean);
  }

  // Single key.
  return [s];
}

const API_KEY_RAW = process.env.API_KEY === undefined ? 'alamin899' : process.env.API_KEY;
const UPSTREAM_API_KEYS = parseApiKeys(API_KEY_RAW);
let upstreamApiKeyIndex = 0;

function getNextUpstreamApiKey() {
  if (UPSTREAM_API_KEYS.length === 0) return '';
  const key = UPSTREAM_API_KEYS[upstreamApiKeyIndex % UPSTREAM_API_KEYS.length];
  upstreamApiKeyIndex = (upstreamApiKeyIndex + 1);
  return key;
}

const ORDER_LIST_URL = `${BASE_URL}/test/orders-by-date`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders() {
  const h = { accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const apiKey = getNextUpstreamApiKey();
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

async function orderList({ start_date, end_date }) {
  const url = new URL(ORDER_LIST_URL);
  url.searchParams.set('start_date', start_date);
  url.searchParams.set('end_date', end_date);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Upstream ${res.status}: ${body}`);
    return JSON.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}

// ── MCP Server factory ────────────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({
    name: 'amarpet-order-list-mcp',
    version: '1.1.0',
  });

  server.tool(
    'get_orders',
    'Fetch Amarpet orders between start_date and end_date (YYYY-MM-DD).',
    {
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
      end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
    },
    async ({ start_date, end_date }) => {
      const data = await orderList({ start_date, end_date });
      console.log(`[mcp] get_orders ${start_date}→${end_date} OK`);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  return server;
}

// ── Session store ─────────────────────────────────────────────────────────────

/** @type {Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>} */
const sessions = new Map();

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// 1. Parse JSON body first
app.use(express.json());

// 2. Fix Accept header for ALL requests — must be before any route
app.use((req, _res, next) => {
  if (req.method === 'POST') {
    const a = (req.headers.accept ?? '').toLowerCase();
    if (!a.includes('text/event-stream')) {
      req.headers.accept = 'application/json, text/event-stream';
    }
  }
  if (req.method === 'GET') {
    const a = (req.headers.accept ?? '').toLowerCase();
    if (!a.includes('text/event-stream')) {
      req.headers.accept = req.headers.accept
        ? `${req.headers.accept}, text/event-stream`
        : 'text/event-stream';
    }
  }
  next();
});

// 3. CORS — required for OpenAI / Postman cloud to reach your server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 
    'Content-Type, Accept, Mcp-Session-Id, mcp-session-id, Authorization, x-api-key'
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// 4. Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

// 5. MCP endpoint
app.all(MCP_PATH, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  console.log(`[mcp] ${req.method} session=${sessionId ?? 'none'}`);

  try {
    // ── DELETE: close session ──────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!sessionId || !sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const { server, transport } = sessions.get(sessionId);
      sessions.delete(sessionId);
      await transport.handleRequest(req, res);
      await server.close().catch(() => {});
      return;
    }

    // ── GET: SSE stream for existing session ───────────────────────────────
    if (req.method === 'GET') {
      if (!sessionId || !sessions.has(sessionId)) {
        // No session yet on GET = tool-list discovery by OpenAI.
        // Create a stateless session just to respond with capabilities.
        const server    = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
            console.log(`[mcp] session created: ${id}`);
          },
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // ── POST ──────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      // Reuse existing session
      if (sessionId && sessions.has(sessionId)) {
        const { transport } = sessions.get(sessionId);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Initialize request → create new session
      if (isInitializeRequest(req.body)) {
        const server    = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
            console.log(`[mcp] session created: ${id}`);
          },
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // POST with unknown session
      return res.status(404).json({ error: 'Session not found' });
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[mcp] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message ?? 'Internal server error' });
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`MCP server → http://${HOST}:${PORT}${MCP_PATH}`);
  console.log(`Health     → http://${HOST}:${PORT}/health`);
});