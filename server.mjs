import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { config } from './src/config.mjs';
import { createMcpServer } from './src/mcp.mjs';
import { sessions } from './src/sessions.mjs';
import { createCode, redeemCode } from './src/oauth.mjs';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// ── OAuth 2.0 — required by the MCP spec for HTTP transport ──────────────────
// The server is PUBLIC. OAuth is transparent: tokens are auto-issued to anyone.
// No user login, no API key — Cursor/VS Code just gets a token silently.

// RFC 9728 — tells clients which auth server to use (this same server)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = origin(req);
  res.json({ resource: base, authorization_servers: [base] });
});

// RFC 8414 — OAuth 2.0 Authorization Server Metadata
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = origin(req);
  res.json({
    issuer:                               base,
    authorization_endpoint:              `${base}/oauth/authorize`,
    token_endpoint:                       `${base}/oauth/token`,
    registration_endpoint:               `${base}/oauth/register`,   // ← fixes the error
    response_types_supported:            ['code'],
    grant_types_supported:               ['authorization_code'],
    code_challenge_methods_supported:    ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

// RFC 7591 — Dynamic Client Registration (Cursor calls this before starting OAuth)
app.post('/oauth/register', (req, res) => {
  // Public server: accept any registration, return a working client_id
  res.status(201).json({
    client_id:                'mcp-public-client',
    client_secret_expires_at: 0,
    redirect_uris:            req.body.redirect_uris ?? [],
    token_endpoint_auth_method: 'none',
    grant_types:              ['authorization_code'],
    response_types:           ['code'],
  });
});

// Authorization endpoint — auto-issues a code immediately (no login page, public server)
app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state, code_challenge } = req.query;
  if (!redirect_uri || !code_challenge) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri and code_challenge are required' });
  }
  const code = createCode(code_challenge);
  const url  = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

// Token endpoint — exchanges code + PKCE verifier for a Bearer token
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, code_verifier } = req.body;
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  const token = redeemCode(code, code_verifier);
  if (!token) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code is invalid, expired, or PKCE check failed' });
  }
  res.json({ access_token: token, token_type: 'Bearer', expires_in: 86400 });
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.count() });
});

// ── MCP endpoint — fully public, no auth check ────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function origin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, config.host, () => {
  console.log(`MCP    → http://${config.host}:${config.port}${config.mcpPath}`);
  console.log(`Health → http://${config.host}:${config.port}/health`);
});
