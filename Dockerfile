# syntax=docker/dockerfile:1.7
#
# VORA — the production image (Railway migration §4.9, R7). Railway always builds a root
# Dockerfile; the same file builds on your Mac and in the clean-room check, so every build is the
# same. Nothing here reads a secret: all configuration arrives at run time as Railway variables.
#
#   docker build -t vora-web .
#   docker run --rm -p 3000:3000 -v "$PWD/.vora/docker-data:/data" --env-file <file> vora-web
#
# Pinned inputs: the official Node 24.21.0 image (OpenSSL ≥ 3.2 is needed for crypto.argon2) and
# Litestream 0.5.17, both by digest.

ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG LITESTREAM_IMAGE=litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a

FROM ${LITESTREAM_IMAGE} AS litestream

# --- 1. Build: the full dependency tree, the client assets and the server bundle -----------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json .npmrc ./
# No BuildKit secret mounts (Railway's builder rejects them). The build reads no secret: npm uses
# the public registry over normal TLS.
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx react-router build \
 && rm -f build/server/.dev.vars

# --- 2. Production dependencies only ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# --- 3. Runtime ------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    TZ=UTC \
    UV_THREADPOOL_SIZE=8 \
    PORT=3000 \
    HOST=:: \
    DATABASE_PATH=/data/vora.db \
    LITESTREAM_CONFIG=/app/litestream.yml

WORKDIR /app
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json litestream.yml ./
COPY docker/litestream.file.yml ./docker/litestream.file.yml
COPY migrations ./migrations
COPY docker/entrypoint.sh /usr/local/bin/vora-entrypoint

# The application directory is read-only for the service user; only /data is written. /data is the
# mount point for the Railway volume, attached by Railway (no Dockerfile VOLUME: Railway rejects it).
RUN chmod 0555 /usr/local/bin/vora-entrypoint \
 && mkdir -p /data \
 && chown node:node /data \
 && chmod -R a-w /app

USER node
EXPOSE 3000

# Started directly (never through npm, which swallows SIGTERM). The entrypoint restores from the
# Litestream replica when the volume is empty, then runs the server under `litestream replicate`
# when R2 backups are configured.
ENTRYPOINT ["/usr/local/bin/vora-entrypoint"]
CMD ["node", "--enable-source-maps", "build/server/index.js"]
