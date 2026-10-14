# syntax=docker/dockerfile:1

# =============================================================================
# Foundry Monitor Dashboard — production image
#
# Single-container build: Fastify serves both the built React SPA and the
# `/api/*` endpoints on one port. Defaults to MOCK data so the image runs with
# zero configuration. See README.md for live Azure data.
# =============================================================================

# ---- Stage 1: install all deps and build the static SPA --------------------
FROM node:22-slim AS build
WORKDIR /app

# Install dependencies first to maximise Docker layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build the client bundle into ./dist.
COPY . .
RUN npm run build

# ---- Stage 2: lean runtime -------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only. `tsx` is a production dependency, so the server
# can run TypeScript directly without a separate compile step.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code needed at runtime + the built UI, owned by the unprivileged
# `node` user that ships with the base image.
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --from=build --chown=node:node /app/dist ./dist

# Container-friendly defaults: deterministic mock data, bound to all interfaces
# inside the container, serving the built UI from ./dist on one port.
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_SOURCE=mock \
    SERVE_STATIC=true \
    ALLOW_RAW_CONTENT=false

EXPOSE 8080
USER node

# Liveness via the API's own health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"]

# Run the server with node as PID 1 (single process) so `docker stop` delivers
# SIGTERM directly and the container stops promptly.
CMD ["node","--import","tsx","server/index.ts"]
