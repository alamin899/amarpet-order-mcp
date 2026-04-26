import { config } from './config.mjs';
import { validateBearerToken } from './oauth.mjs';

// Paths that never require authentication
const PUBLIC_PATHS    = new Set(['/', '/connect', '/health']);
const PUBLIC_PREFIXES = ['/oauth/', '/.well-known/'];

export function validateApiKey(key) {
  if (config.clientApiKeys.length === 0) return true; // open server
  return config.clientApiKeys.includes(String(key ?? '').trim());
}

export function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();
  if (req.method === 'OPTIONS') return next();

  // 1. Direct x-api-key header (legacy / manual config)
  const directKey = String(req.headers['x-api-key'] ?? '').trim();
  if (directKey && validateApiKey(directKey)) return next();

  // 2. OAuth Bearer token (issued after browser auth flow)
  const authHeader = String(req.headers['authorization'] ?? '');
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (validateBearerToken(token)) return next();
  }

  // 3. Neither valid → send OAuth challenge so Cursor opens the browser
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="${serverUrl}", resource_metadata="${serverUrl}/.well-known/oauth-protected-resource"`
  );
  return res.status(401).json({
    error: 'unauthorized',
    message: 'Open the server URL in a browser to authenticate.',
    connect_url: `${serverUrl}/connect`,
  });
}

// ── HTML pages ────────────────────────────────────────────────────────────────

const CARD_STYLE = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#0f172a;color:#e2e8f0;min-height:100vh;
       display:flex;align-items:center;justify-content:center}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;
        padding:40px;width:100%;max-width:460px}
  .logo{font-size:26px;font-weight:700;color:#38bdf8;margin-bottom:4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:28px}
  label{display:block;font-size:11px;font-weight:600;color:#94a3b8;
        margin-bottom:8px;letter-spacing:.07em;text-transform:uppercase}
  input[type=text]{width:100%;padding:11px 14px;background:#0f172a;
    border:1px solid #334155;border-radius:8px;color:#e2e8f0;
    font-size:14px;font-family:monospace;outline:none;transition:border-color .15s}
  input[type=text]:focus{border-color:#38bdf8}
  button{width:100%;padding:11px;margin-top:14px;background:#0ea5e9;
    color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;
    cursor:pointer;transition:background .15s}
  button:hover{background:#38bdf8}
  .alert{font-size:13px;padding:10px 14px;border-radius:6px;margin-bottom:18px}
  .error{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)}
  .hint{color:#475569;font-size:12px;margin-top:20px;line-height:1.7}
  .hint code{background:#0f172a;padding:2px 6px;border-radius:4px;color:#38bdf8}
`;

// Manual connect page — for users visiting the server directly
export function connectPage(showError = false) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AmarPet MCP — Connect</title><style>${CARD_STYLE}</style></head>
<body><div class="card">
  <div class="logo">AmarPet MCP</div>
  <div class="sub">Order List Server · Authentication</div>
  ${showError ? `<div class="alert error">Invalid API key — please try again.</div>` : ''}
  <form method="POST" action="/connect">
    <label for="key">API Key</label>
    <input type="text" id="key" name="key" placeholder="Enter your API key" autofocus autocomplete="off">
    <button type="submit">Verify &amp; Connect →</button>
  </form>
  <p class="hint">Your key is checked against the server's allowed-key list.<br>
  Once verified you'll get the exact config to paste into your MCP client.</p>
</div></body></html>`;
}

// OAuth authorize page — opened automatically by Cursor/VS Code
export function oauthAuthorizePage({ redirectUri, state, codeChallenge, codeChallengeMethod, clientId, showError = false }) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AmarPet MCP — Authorize</title><style>${CARD_STYLE}
  .badge{display:inline-flex;align-items:center;gap:6px;
    background:rgba(99,102,241,.12);color:#818cf8;
    border:1px solid rgba(99,102,241,.3);
    padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;
    margin-bottom:22px}
</style></head>
<body><div class="card">
  <div class="logo">AmarPet MCP</div>
  <div class="sub">Order List Server · Authorization</div>
  <div class="badge">🔌 MCP Client Connection Request</div>
  ${showError ? `<div class="alert error">Invalid API key — please try again.</div>` : ''}
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="redirect_uri"           value="${esc(redirectUri)}">
    <input type="hidden" name="state"                  value="${esc(state)}">
    <input type="hidden" name="code_challenge"         value="${esc(codeChallenge)}">
    <input type="hidden" name="code_challenge_method"  value="${esc(codeChallengeMethod)}">
    <input type="hidden" name="client_id"              value="${esc(clientId)}">
    <label for="key">API Key</label>
    <input type="text" id="key" name="key" placeholder="Enter your API key" autofocus autocomplete="off">
    <button type="submit">Authorize Connection →</button>
  </form>
  <p class="hint">This grants your MCP client access to <code>get_orders</code>.<br>
  The session token expires in 24 hours.</p>
</div></body></html>`;
}

// Success page — shown after manual /connect verification
export function successPage(key, mcpUrl) {
  const cfg = JSON.stringify({ url: mcpUrl, type: 'http', headers: { 'x-api-key': key } }, null, 2);
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AmarPet MCP — Connected</title><style>${CARD_STYLE}
  .ok{display:inline-flex;align-items:center;gap:6px;
    background:rgba(34,197,94,.1);color:#4ade80;
    border:1px solid rgba(34,197,94,.3);
    padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:26px}
  h3{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;
     letter-spacing:.07em;margin-bottom:10px}
  pre{background:#0f172a;border:1px solid #334155;border-radius:8px;
      padding:16px;font-size:12px;line-height:1.8;overflow-x:auto;margin-bottom:8px}
  .copy{width:auto;padding:6px 14px;margin-top:0;font-size:12px;background:#1e3a5f;
        display:block;margin-left:auto;margin-bottom:18px}
  .foot{color:#334155;font-size:12px;line-height:1.6}
  .foot code{background:#0f172a;padding:2px 6px;border-radius:4px;color:#38bdf8}
</style></head>
<body><div class="card">
  <div class="logo">AmarPet MCP</div>
  <div class="sub">Order List Server</div>
  <div class="ok">✓ API Key Verified</div>
  <h3>MCP Client Config</h3>
  <pre id="cfg">${cfg}</pre>
  <button class="copy" onclick="navigator.clipboard.writeText(document.getElementById('cfg').innerText).then(()=>this.textContent='Copied ✓')">Copy</button>
  <p class="foot">Paste into <code>.vscode/mcp.json</code>, Cursor, or Claude Desktop.<br>
  The <code>get_orders</code> tool will then be available.</p>
</div></body></html>`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
