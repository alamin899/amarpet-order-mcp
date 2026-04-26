import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { config } from './src/config.mjs';
import { createMcpServer } from './src/mcp.mjs';
import { sessions } from './src/sessions.mjs';
import { createAuthCode, redeemCode } from './src/oauth.mjs';
import {
  authMiddleware, validateApiKey,
  connectPage, oauthAuthorizePage, successPage,
} from './src/auth.mjs';

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────────

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
    'Content-Type, Accept, Mcp-Session-Id, mcp-session-id, Authorization, x-api-key'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// API key / Bearer token guard (skips public paths — see src/auth.mjs)
app.use(authMiddleware);

// ── OAuth 2.0 discovery endpoints ─────────────────────────────────────────────

// RFC 8414 — Authorization Server Metadata
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = serverBase(req);
  res.json({
    issuer:                                base,
    authorization_endpoint:               `${base}/oauth/authorize`,
    token_endpoint:                        `${base}/oauth/token`,
    response_types_supported:             ['code'],
    grant_types_supported:                ['authorization_code'],
    code_challenge_methods_supported:     ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

// RFC 9728 — Protected Resource Metadata (tells client which auth server to use)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = serverBase(req);
  res.json({
    resource:             base,
    authorization_servers: [base],
  });
});

// ── OAuth 2.0 authorization flow ──────────────────────────────────────────────

// Step 1: Cursor opens this URL in the browser (PKCE authorization code flow)
app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method = 'S256', client_id = '' } = req.query;

  if (!redirect_uri || !code_challenge) {
    return res.status(400).send('Missing required OAuth parameters: redirect_uri, code_challenge');
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(oauthAuthorizePage({
    redirectUri: redirect_uri, state, codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method, clientId: client_id,
  }));
});

// Step 2: User submits their API key — server validates and redirects back to Cursor
app.post('/oauth/authorize', (req, res) => {
  const { key, redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.body;

  if (!validateApiKey(key)) {
    res.setHeader('Content-Type', 'text/html');
    return res.send(oauthAuthorizePage({
      redirectUri: redirect_uri, state, codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method, clientId: client_id,
      showError: true,
    }));
  }

  const code = createAuthCode({
    apiKey: String(key).trim(),
    codeChallenge: code_challenge,
    redirectUri: redirect_uri,
    state,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return res.redirect(redirectUrl.toString());
});

// Step 3: Cursor exchanges the authorization code for a Bearer token
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, code_verifier } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'code and code_verifier are required' });
  }

  const token = redeemCode(code, code_verifier);
  if (!token) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code is invalid, expired, or PKCE verification failed' });
  }

  res.json({ access_token: token, token_type: 'Bearer', expires_in: 86400 });
});

// ── Manual connect page (for users visiting the server directly) ──────────────

app.get(['/', '/connect'], (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(connectPage(req.query.error === 'invalid'));
});

app.post('/connect', (req, res) => {
  const key = String(req.body.key ?? '').trim();
  if (!validateApiKey(key)) {
    res.setHeader('Content-Type', 'text/html');
    return res.send(connectPage(true));
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(successPage(key, `${serverBase(req)}${config.mcpPath}`));
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.count() });
});

// ── MCP endpoint ──────────────────────────────────────────────────────────────

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

function serverBase(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, config.host, () => {
  console.log(`MCP     → http://${config.host}:${config.port}${config.mcpPath}`);
  console.log(`Auth    → http://${config.host}:${config.port}/connect`);
  console.log(`Health  → http://${config.host}:${config.port}/health`);
});
