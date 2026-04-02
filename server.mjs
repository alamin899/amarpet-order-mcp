import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8000/api/v1';
const ORDER_LIST_URL = `${baseUrl}/test/orders-by-date`;
function buildHeaders() {
  const headers = {
    'accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  return headers;
}

async function orderList({ start_date, end_date }) {
  const url = new URL(ORDER_LIST_URL);
  url.searchParams.set('start_date', start_date);
  url.searchParams.set('end_date',end_date)

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(),
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.text().catch(() => '') : await res.text().catch(() => '');
    throw new Error(`Order list API request failed (${res.status} ${res.statusText}): ${body}`);
  }

  return await res.json();
}

const mcpServer = new McpServer({
  name: 'amarpet-order-list-mcp',
  version: '1.0.0',
});

// Single tool: call only the order list endpoint and return its JSON.
mcpServer.registerTool(
  'get_orders',
  {
    description: 'Fetch orders ordered by the given date (GET /api/v1/test/orders-by-date?date=...).',
    inputSchema: {
      start_date: z.string().describe('Start date to filter/order by (e.g., YYYY-MM-DD or ISO-8601).'),
      end_date: z.string().describe('End date to filter/order by (e.g., YYYY-MM-DD or ISO-8601).'),
    },
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
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('MCP server "amarpet-order-list" running on stdio');
}

main()
.catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

