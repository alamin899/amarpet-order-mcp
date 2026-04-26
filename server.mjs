import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { config } from './src/config.mjs';
import { createMcpServer } from './src/mcp.mjs';
import { sessions } from './src/sessions.mjs';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());

// Ensure SSE-compatible Accept headers for MCP streaming
app.use((req, _res, next) => {
  const accept = req.headers.accept ?? '';
  if (req.method === 'POST' && !accept.includes('text/event-stream')) {
    req.headers.accept = 'application/json, text/event-stream';
  }
  if (req.method === 'GET' && !accept.includes('text/event-stream')) {
    req.headers.accept = accept ? `${accept}, text/event-stream` : 'text/event-stream';
  }
  next();
});

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Accept, Mcp-Session-Id, mcp-session-id, Authorization'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.count() });
});

app.all(config.mcpPath, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  console.log(`[mcp] ${req.method} session=${sessionId ?? 'none'}`);

  try {
    switch (req.method) {
      case 'DELETE': {
        if (!sessionId || !sessions.has(sessionId)) {
          return res.status(404).json({ error: 'Session not found' });
        }
        const { server, transport } = sessions.get(sessionId);
        sessions.delete(sessionId);
        await transport.handleRequest(req, res);
        await server.close().catch(() => {});
        return;
      }

      case 'GET': {
        if (!sessionId || !sessions.has(sessionId)) return await startSession(req, res);
        const { transport } = sessions.get(sessionId);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      case 'POST': {
        if (sessionId && sessions.has(sessionId)) {
          const { transport } = sessions.get(sessionId);
          await transport.handleRequest(req, res, req.body);
          return;
        }
        if (isInitializeRequest(req.body)) return await startSession(req, res);
        return res.status(404).json({ error: 'Session not found' });
      }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[mcp] error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

async function startSession(req, res) {
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
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, config.host, () => {
  console.log(`MCP    → http://${config.host}:${config.port}${config.mcpPath}`);
  console.log(`Health → http://${config.host}:${config.port}/health`);
});
