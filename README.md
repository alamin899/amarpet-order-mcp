# Amarpet order list MCP

Node.js MCP server with one tool: **`get_orders`**.

Calls Amarpet:

`GET {BASE_URL}/test/orders-by-date?start_date=...&end_date=...`

(`BASE_URL` may be `https://admin.amarpet.com/api/v1` — `/test` is added automatically when missing.)

## Run locally

```bash
cp .env.example .env
# edit .env
npm start
```

Env:

- **`BASE_URL`** — API base (see above).
- **`PORT`** — HTTP listen port (default **`3000`**).
- **`HOST`** — bind address (default **`0.0.0.0`**).
- **`MCP_PATH`** — MCP route (default **`/mcp`**).
- **`API_KEY`** — if set, sent as **`x-api-key`** on upstream Amarpet requests.
- **`ALLOWED_HOSTS`** (or legacy **`ALLOWED_HOST`**) — comma-separated hostnames/IPs allowed in the **`Host`** header when **`HOST`** is **`0.0.0.0`**. Include the **same** host you use in the MCP URL (e.g. **`165.232.154.13`** or your domain). If this does not match, Cursor gets **403** and the MCP may look “broken.”

## Docker

The server exposes **MCP over HTTP** (streamable HTTP transport) on **`PORT`**.

### Build

```bash
docker build -t amarpet-order-mcp .
```

### Run (publish port)

```bash
docker run --rm -p 3000:3000 \
  -e BASE_URL=https://admin.amarpet.com/api/v1 \
  -e API_KEY=your-amarpet-api-key \
  amarpet-order-mcp
```

Or with an env file:

```bash
docker run --rm -p 3000:3000 --env-file .env amarpet-order-mcp
```

### Cursor MCP (HTTP)

**Remote URL (e.g. `http://165.232.154.13:3000/mcp`):** use **Connect** to start the session. This server does **not** implement OAuth or bearer auth on `/mcp` — you can **ignore** any **Authenticate** / OAuth prompt; Cursor sometimes shows it for all remote HTTP MCPs.

1. Copy the example and point **`url`** at your server (local or deployed): **`http://<host>:<port><MCP_PATH>`** (defaults: **`http://127.0.0.1:3000/mcp`**).

   ```bash
   cp .cursor/mcp.json.example .cursor/mcp.json
   ```

2. Merge the **`mcpServers`** block into Cursor’s MCP settings if you use global config (**`~/.cursor/mcp.json`**) instead of the project file.

3. Restart Cursor after changing MCP configuration.

For a **remote** deployment, set **`ALLOWED_HOSTS`** to your VM **public IP** and/or **domain** (same value clients put in the URL). If you use GitHub Actions deploy, **`ALLOWED_HOSTS`** defaults to **`VM_PUBLIC_IP`** when unset.

### OpenAI Responses API (`tools[].type: "mcp"`)

OpenAI’s servers must reach your **`server_url` over the public internet** (not `192.168.x.x`). Open port **3000** (or your mapped port) on the VM firewall.

If you see **`424 Failed Dependency`** / **`Error retrieving tool list`**, it was often because Streamable HTTP requires **`Accept: application/json, text/event-stream`** on POST; this server **normalizes** that header for `/mcp` so OpenAI’s connector can list tools. Redeploy/restart after pulling the fix.

## Tool: `get_orders`

- **`start_date`** — e.g. `YYYY-MM-DD`
- **`end_date`** — e.g. `YYYY-MM-DD`
