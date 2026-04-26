import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchOrders } from './upstream.mjs';

export function createMcpServer() {
  const server = new McpServer({ name: 'amarpet-order-list-mcp', version: '1.1.0' });

  server.tool(
    'get_orders',
    'Fetch Amarpet orders between start_date and end_date (YYYY-MM-DD).',
    {
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
      end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
    },
    async ({ start_date, end_date }) => {
      const data = await fetchOrders(start_date, end_date);
      console.log(`[mcp] get_orders ${start_date}→${end_date} OK`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}
