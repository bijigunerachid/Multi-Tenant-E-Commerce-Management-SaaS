# syntax=docker/dockerfile:1.7
# Web image: the built web app served by Caddy, which also forwards /api to the API and handles
# HTTPS. Build from the repository root:
#   docker build -f frontend/Dockerfile -t vendora-web .

ARG NODE_IMAGE=node:22.23.3-bookworm-slim
ARG CADDY_IMAGE=caddy:2.10.2-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# No install scripts, as in development: the build tools use their prebuilt platform packages.
RUN npm ci --workspace frontend --include-workspace-root=false --ignore-scripts
COPY frontend frontend
RUN npm run build --workspace frontend

FROM ${CADDY_IMAGE}
# Run as an unprivileged user that may still bind ports 80 and 443.
RUN apk add --no-cache libcap \
  && setcap cap_net_bind_service=+ep /usr/bin/caddy \
  && addgroup -S caddy && adduser -S -G caddy -h /data caddy \
  && mkdir -p /data /config && chown -R caddy:caddy /data /config
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
USER caddy
EXPOSE 80 443 443/udp
