# syntax=docker/dockerfile:1.7
# API and worker image (one image, two commands). Build from the repository root:
#   docker build -f backend/Dockerfile -t vendora-api .
# Runs as the unprivileged "node" user. The same image runs migrations (see
# docker-compose.prod.yml) and the worker (`node src/worker.js`).

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM ${NODE_IMAGE} AS base
# OpenSSL for the Prisma query engine; CA certificates for Stripe and SMTP over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
# Every workspace manifest is needed for npm to read the lockfile; only the backend is installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# --ignore-scripts keeps the same rule as development (package.json "allowScripts"): no install
# scripts run. argon2 loads its prebuilt binary at runtime; the Prisma client is generated below.
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY backend/prisma backend/prisma
RUN node node_modules/prisma/build/index.js generate --schema backend/prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production \
  PORT=4100 \
  UPLOAD_DIR=/app/backend/uploads
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node backend/prisma backend/prisma
COPY --chown=node:node backend/src backend/src
RUN mkdir -p /app/backend/uploads && chown node:node /app/backend/uploads
USER node
WORKDIR /app/backend
EXPOSE 4100
# Liveness only: readiness (database and Redis) is /api/v1/health/ready, for load balancers.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server.js"]
