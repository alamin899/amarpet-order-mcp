/** @type {Map<string, { server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer, transport: any }>} */
const store = new Map();

export const sessions = {
  get:    (id) => store.get(id),
  has:    (id) => store.has(id),
  set:    (id, session) => store.set(id, session),
  delete: (id) => store.delete(id),
  count:  ()   => store.size,
};
