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
- **`ALLOWED_HOST`** — optional extra **Host** allowed by the MCP app when **`HOST`** is **`0.0.0.0`** (e.g. your public domain behind a reverse proxy).

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

1. Copy the example and point **`url`** at your server (local or deployed): **`http://<host>:<port><MCP_PATH>`** (defaults: **`http://127.0.0.1:3000/mcp`**).

   ```bash
   cp .cursor/mcp.json.example .cursor/mcp.json
   ```

2. Merge the **`mcpServers`** block into Cursor’s MCP settings if you use global config (**`~/.cursor/mcp.json`**) instead of the project file.

3. Restart Cursor after changing MCP configuration.

For a **remote** deployment, use **`https://your-domain/mcp`** (or your VM’s URL) and ensure **`ALLOWED_HOST`** matches the **Host** header your proxy sends.

## Tool: `get_orders`

- **`start_date`** — e.g. `YYYY-MM-DD`
- **`end_date`** — e.g. `YYYY-MM-DD`
