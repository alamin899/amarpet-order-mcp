import { config } from './config.mjs';

// Public paths that bypass API key checks
const PUBLIC_PATHS = ['/', '/connect', '/health'];

export function validateApiKey(key) {
  if (config.clientApiKeys.length === 0) return true; // open server
  return config.clientApiKeys.includes(String(key ?? '').trim());
}

export function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path) || req.method === 'OPTIONS') return next();

  const key = req.headers['x-api-key'];
  if (!validateApiKey(key)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'A valid x-api-key header is required. Visit /connect to verify your key.',
    });
  }

  next();
}

// ── HTML pages ────────────────────────────────────────────────────────────────

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f172a; color: #e2e8f0;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  .card {
    background: #1e293b; border: 1px solid #334155;
    border-radius: 12px; padding: 40px; width: 100%; max-width: 460px;
  }
  .logo  { font-size: 26px; font-weight: 700; color: #38bdf8; margin-bottom: 4px; }
  .sub   { color: #64748b; font-size: 13px; margin-bottom: 32px; }
  label  {
    display: block; font-size: 12px; font-weight: 600;
    color: #94a3b8; margin-bottom: 8px; letter-spacing: 0.06em; text-transform: uppercase;
  }
  input[type="text"] {
    width: 100%; padding: 11px 14px;
    background: #0f172a; border: 1px solid #334155; border-radius: 8px;
    color: #e2e8f0; font-size: 14px; font-family: monospace; outline: none;
    transition: border-color 0.15s;
  }
  input[type="text"]:focus { border-color: #38bdf8; }
  button {
    width: 100%; padding: 11px; margin-top: 14px;
    background: #0ea5e9; color: #fff; border: none; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s;
  }
  button:hover { background: #38bdf8; }
  .alert {
    font-size: 13px; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px;
  }
  .alert-error { background: rgba(239,68,68,.12); color: #f87171; border: 1px solid rgba(239,68,68,.25); }
  .hint { color: #475569; font-size: 12px; margin-top: 22px; line-height: 1.7; }
  .hint code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #38bdf8; }
`;

export function connectPage(showError = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AmarPet MCP — Connect</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="logo">AmarPet MCP</div>
    <div class="sub">Order List Server · Authentication</div>

    ${showError ? `<div class="alert alert-error">Invalid API key — please try again.</div>` : ''}

    <form method="POST" action="/connect">
      <label for="key">API Key</label>
      <input type="text" id="key" name="key" placeholder="Enter your API key" autofocus autocomplete="off">
      <button type="submit">Verify &amp; Connect →</button>
    </form>

    <p class="hint">
      Your key will be verified against the server's allowed-key list.<br>
      Once verified you'll receive the exact config to paste into your MCP client.
    </p>
  </div>
</body>
</html>`;
}

export function successPage(key, mcpUrl) {
  const configJson = JSON.stringify({
    url: mcpUrl,
    type: 'http',
    headers: { 'x-api-key': key },
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AmarPet MCP — Connected</title>
  <style>
    ${BASE_STYLES}
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(34,197,94,.1); color: #4ade80;
      border: 1px solid rgba(34,197,94,.3);
      padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
      margin-bottom: 28px;
    }
    h3 { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
    pre {
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      padding: 16px; font-size: 12px; line-height: 1.7; color: #e2e8f0;
      overflow-x: auto; margin-bottom: 20px; white-space: pre;
    }
    .copy-btn {
      width: auto; padding: 7px 16px; margin-top: 0; font-size: 12px;
      background: #1e3a5f; float: right; margin-top: -44px; margin-right: 8px;
      position: relative; z-index: 1;
    }
    .footer { color: #334155; font-size: 12px; line-height: 1.6; clear: both; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">AmarPet MCP</div>
    <div class="sub">Order List Server</div>
    <div class="badge">✓ API Key Verified</div>

    <h3>MCP Client Config</h3>
    <pre id="cfg">${configJson}</pre>
    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('cfg').innerText).then(()=>this.textContent='Copied!')">Copy</button>

    <p class="footer">
      Paste this into your MCP client settings (VS Code <code>.vscode/mcp.json</code>,
      Cursor, or Claude Desktop). The <code>get_orders</code> tool will then be available.
    </p>
  </div>
</body>
</html>`;
}
