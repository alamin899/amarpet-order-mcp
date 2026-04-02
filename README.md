# Amarpet MCP Server (Orders By Date)

This MCP server exposes a single tool: `get_orders`.

It calls:

`GET ${AMARPET_ORDER_LIST_URL}?start_date=<start_date>&end_date=<end_date>&date=<start_date>`

and returns the JSON response.

## Run

```bash
npm start
```

## Configuration

Set the order-list URL in your `.env`:

`AMARPET_ORDER_LIST_URL` (see `.env.example`)

## MCP Tool

Tool name: `get_orders`

Input:
- `start_date` (string, optional): start of the range (YYYY-MM-DD or ISO-8601). Defaults to today (local time).
- `end_date` (string, optional): end of the range (YYYY-MM-DD or ISO-8601). Defaults to today (local time).
- `date` (string, optional): legacy alias; if provided, it will be used for both start_date and end_date.

