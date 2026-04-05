# syntax=docker/dockerfile:1
# Amarpet orders MCP server (stdio). Pass secrets at runtime, not baked into the image.
#
# Build:
#   docker build -t amarpet-order-mcp .
#
# Run (stdio MCP host must attach stdin/stdout, e.g.):
#   docker run --rm -i -e BASE_URL=... -e API_KEY=... -e MCP_CLIENT_API_KEY=... amarpet-order-mcp
#
# Or use --env-file .env.production (do not commit real .env).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json server.mjs ./

USER nodejs

# MCP over stdio: keep process in foreground, no shell wrapper
CMD ["node", "server.mjs"]
