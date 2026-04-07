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

function buildHeaders() {
  const headers = {
    accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // Backend যদি custom API key চায়
  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

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
      throw new Error(
        `Order list API request failed (${res.status} ${res.statusText}): ${bodyText}`
      );
    }

    if (contentType.includes('application/json')) {
      return JSON.parse(bodyText);
    }

    throw new Error(`Unexpected response content-type: ${contentType}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createServer() {
  const server = new McpServer(
    {
      name: 'amarpet-order-list-mcp',
      version: '1.1.0',
    },
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
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Start date in YYYY-MM-DD format'),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('End date in YYYY-MM-DD format'),
      }),
    },
    async ({ start_date, end_date }) => {
      const data = await orderList({ start_date, end_date });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
        structuredContent: data,
      };
    }
  );

  return server;
}

/** @type {Map<string, { server: McpServer; transport: import('@modelcontextprotocol/node').NodeStreamableHTTPServerTransport }>} */
const mcpSessions = new Map();

function getMcpSessionHeader(req) {
  const raw = req.headers['mcp-session-id'] ?? req.headers['Mcp-Session-Id'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

async function main() {
  const app = createMcpExpressApp({
    host: HOST,
    allowedHosts:
      HOST === '0.0.0.0'
        ? [
            'localhost',
            '127.0.0.1',
            process.env.ALLOWED_HOST || '',
          ].filter(Boolean)
        : undefined,
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'amarpet-order-list-mcp',
      version: '1.1.0',
    });
  });

  // MCP endpoint — streamable HTTP is stateful: reuse server+transport per mcp-session-id.
  app.all(MCP_PATH, async (req, res) => {
    const sessionHeader = getMcpSessionHeader(req);

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

      if (sessionHeader && !mcpSessions.has(sessionHeader)) {
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

      const { server, transport } = session;
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId && !mcpSessions.has(transport.sessionId)) {
        mcpSessions.set(transport.sessionId, session);
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
    console.error(
      `MCP server running at http://${HOST}:${PORT}${MCP_PATH}`
    );
    console.error(`Health check at http://${HOST}:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});