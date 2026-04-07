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
- **`API_KEYS`** or **`API_KEY`** — sent as **`X-API-Key`** (override with **`API_KEY_HEADER`**).

## Docker

This app speaks **MCP over stdio** (stdin/stdout). It does **not** open an HTTP port.

### Build

```bash
docker build -t amarpet-order-mcp .
```

### Run (interactive — required for MCP)

```bash
docker run --rm -i \
  -e BASE_URL=https://admin.amarpet.com/api/v1 \
  -e API_KEYS=your-api-key \
  amarpet-order-mcp
```

Or with an env file:

```bash
docker run --rm -i --env-file .env amarpet-order-mcp
```

Always use **`-i`** (interactive stdin). Without it, MCP clients cannot talk to the process.

### Docker Compose

```bash
cp .env.example .env
# edit .env
docker compose run --rm -i mcp
```

### Cursor MCP (example)

Point the MCP server at Docker with stdio:

```json
{
  "mcpServers": {
    "amarpet-orders": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env-file", "/absolute/path/to/.env",
        "amarpet-order-mcp:latest"
      ]
    }
  }
}
```

### VM / `docker run -d`

A **detached** container has **no attached stdin**; Cursor (and typical MCP hosts) **cannot** use it over stdio. Detached runs are only useful if you add an **HTTP/SSE** MCP transport later, or for keeping a pulled image on the server. Prefer **`docker compose run --rm -i`** or **`docker run --rm -i`** on the machine where the MCP client runs.

## Tool: `get_orders`

- **`start_date`** — e.g. `YYYY-MM-DD`
- **`end_date`** — e.g. `YYYY-MM-DD`
