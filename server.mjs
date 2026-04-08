import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || 'https://admin.amarpet.com/api/v1';
const MCP_PATH = process.env.MCP_PATH || '/mcp';
const API_KEY = process.env.API_KEY || '';
const ORDER_LIST_URL = `${BASE_URL}/test/orders-by-date`;

function parseAllowedHosts() {
  const raw = process.env.ALLOWED_HOSTS || process.env.ALLOWED_HOST || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function buildHeaders() {
  const headers = {
    accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function orderList({ start_date, end_date }) {
  if (!isValidDate(start_date) || !isValidDate(end_date)) {
    throw new Error('start_date and end_date must be in YYYY-MM-DD format');
  }
  const url = new URL(ORDER_LIST_URL);
  url.searchParams.set('start_date', start_date);
  url.searchParams.set('end_date', end_date);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`Order list API failed (${res.status} ${res.statusText}): ${bodyText}`);
    }
    if (contentType.includes('application/json')) return JSON.parse(bodyText);
    throw new Error(`Unexpected content-type: ${contentType}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createServer() {
  const server = new McpServer(
    { name: 'amarpet-order-list-mcp', version: '1.1.0' },
    {
      instructions:
        'Use get_orders to fetch Amarpet orders between a start date and end date. Dates must be in YYYY-MM-DD format.',
    }
  );

  server.registerTool(
    'get_orders',
    {
      title: 'Get orders',
      description: 'Fetch Amarpet orders between start_date and end_date.',
      inputSchema: z.object({
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
      }),
    },
    async ({ start_date, end_date }) => {
      const data = await orderList({ start_date, end_date });
      console.error(`[mcp] ${new Date().toISOString()} get_orders OK`);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    }
  );

  return server;
}

/** @type {Map<string, { server: McpServer; transport: NodeStreamableHTTPServerTransport }>} */
const mcpSessions = new Map();

function getMcpSessionHeader(req) {
  const raw = req.headers['mcp-session-id'] ?? req.headers['Mcp-Session-Id'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

/**
 * FIX 1: Patch Accept headers GLOBALLY before any framework middleware.
 * OpenAI's MCP connector only sends Accept: application/json.
 * Streamable HTTP requires both application/json AND text/event-stream.
 * Without this global placement, @modelcontextprotocol/express returns 406 → 424.
 */
function normalizeMcpAcceptHeaders(req, _res, next) {
  if (req.method === 'POST') {
    const a = String(req.headers.accept ?? '').toLowerCase();
    if (!a.includes('application/json') || !a.includes('text/event-stream')) {
      req.headers.accept = 'application/json, text/event-stream';
    }
  }
  if (req.method === 'GET') {
    const a = String(req.headers.accept ?? '').toLowerCase();
    if (!a.includes('text/event-stream')) {
      req.headers.accept = req.headers.accept
        ? `${req.headers.accept}, text/event-stream`
        : 'text/event-stream';
    }
  }
  next();
}

async function main() {
  // FIX 2: Include both bare IP and IP:PORT in allowedHosts.
  // OpenAI sends Host: 165.232.154.13:3000 — without the port variant,
  // the DNS-rebinding guard in createMcpExpressApp returns 403 → 424.
  const allowedHosts =
    HOST === '0.0.0.0'
      ? [
          'localhost',
          'localhost:3000',
          '127.0.0.1',
          '127.0.0.1:3000',
          '165.232.154.13',
          '165.232.154.13:3000', // ← critical for OpenAI connector
          '[::1]',
          '[::1]:3000',
          ...parseAllowedHosts(),
        ]
      : undefined;

  const app = createMcpExpressApp({ host: HOST, allowedHosts });

  // FIX 1 APPLIED: Register globally BEFORE any route, not scoped to MCP_PATH.
  // This ensures it intercepts before @modelcontextprotocol/express internals run.
  app.use(normalizeMcpAcceptHeaders);

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'amarpet-order-list-mcp', version: '1.1.0' });
  });

  // MCP endpoint
  app.all(MCP_PATH, async (req, res) => {
    const sessionHeader = getMcpSessionHeader(req);

    console.error(
      `[mcp] ${req.method} session=${sessionHeader ?? 'new'} accept="${req.headers.accept}"`
    );

    try {
      if (req.method === 'DELETE') {
        if (!sessionHeader || !mcpSessions.has(sessionHeader)) {
          if (!res.headersSent) {
            res.status(404).json({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            });
          }
          return;
        }
        const { server, transport } = mcpSessions.get(sessionHeader);
        mcpSessions.delete(sessionHeader);
        await transport.handleRequest(req, res, req.body);
        await server.close().catch(() => {});
        return;
      }

      // FIX 3: Do NOT 404 on unknown session for GET (tool-list discovery).
      // OpenAI's initial GET has no session yet — allow it to create a new one.
      if (sessionHeader && !mcpSessions.has(sessionHeader) && req.method !== 'GET') {
        if (!res.headersSent) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          });
        }
        return;
      }

      let session = sessionHeader ? mcpSessions.get(sessionHeader) : undefined;

      if (!session) {
        const server = createServer();
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        await server.connect(transport);
        session = { server, transport };
      }

      const { transport } = session;
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId && !mcpSessions.has(transport.sessionId)) {
        mcpSessions.set(transport.sessionId, session);
        console.error(`[mcp] new session registered: ${transport.sessionId}`);
      }
    } catch (error) {
      console.error('MCP request error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  });

  app.listen(PORT, () => {
    console.error(`MCP server running at http://${HOST}:${PORT}${MCP_PATH}`);
    console.error(`Health check at http://${HOST}:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});