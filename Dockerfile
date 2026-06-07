# syntax=docker/dockerfile:1.7
#
# NRCC container image. Multi-stage so the final image carries only
# production dependencies and the application code -- no devDeps, no
# build toolchain, no .git history.
#
# The image expects user data (screenshots, recordings, scripts,
# certs, logs) to live under /data, mounted from a PVC / bind mount
# in the runtime environment. Defaults below match deploy/k8s/nrcc.yaml.

# ---------- 1. dependency layer -----------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# Copy lock + manifest first so the npm install layer is cached on
# every image build that doesn't change dependencies. `npm ci` is
# preferred over `npm install` because it fails fast if the lockfile
# is out of date and never mutates package-lock.json.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --loglevel=error; \
    else \
      npm install --omit=dev --no-audit --no-fund --loglevel=error; \
    fi

# ---------- 1b. Windows ffmpeg for AudioPatch guests --------------------------
# Old Windows guests (e.g. Server 2012) have no winget/choco and often no
# ffmpeg. NRCC serves this static build over plain HTTP so the AudioPatch
# installer can drop it next to the agent -- no internet/TLS needed on the
# guest. gyan.dev "essentials" is a self-contained static build (Windows 7+).
FROM alpine:3.20 AS winffmpeg
RUN apk add --no-cache curl unzip ca-certificates \
 && mkdir -p /win \
 && curl -fsSL --retry 3 -o /tmp/ff.zip \
      https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip \
 && unzip -j /tmp/ff.zip '*/bin/ffmpeg.exe' -d /win \
 && rm /tmp/ff.zip \
 && test -s /win/ffmpeg.exe

# ---------- 2. runtime image --------------------------------------------------
FROM node:20-alpine
WORKDIR /app

# Drop root for the app process. node:20-alpine ships a `node` user
# (uid/gid 1000) we can reuse instead of inventing one. The /data
# directory is owned by node so a fresh PVC mount is writable
# without an init container chowning it.
RUN mkdir -p /data/screenshots /data/recordings /data/scripts /data/certs /data/logs \
 && chown -R node:node /data

# Production node_modules from the deps layer.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# Application source. The .dockerignore filters out everything that
# isn't needed at runtime (node_modules, .git, screenshots, etc.) so
# this COPY brings in just code + assets + manifests.
COPY --chown=node:node . .

# Static Windows ffmpeg served to the AudioPatch installer (see stage above).
COPY --chown=node:node --from=winffmpeg /win/ffmpeg.exe ./public/audiopatch/win/ffmpeg.exe

ENV NODE_ENV=production \
    PORT=8443 \
    NRCC_TLS_CERT_DIR=/data/certs \
    NRCC_SCREENSHOTS_DIR=/data/screenshots \
    NRCC_RECORDINGS_DIR=/data/recordings \
    NRCC_SCRIPTS_DIR=/data/scripts \
    NRCC_LOGS_DIR=/data/logs \
    HOME=/tmp

USER node

EXPOSE 8443

# Lightweight TCP healthcheck so an orchestrator (k8s readinessProbe,
# docker-compose, etc.) gets a useful signal without touching the
# Express stack. The actual readiness probe in deploy/k8s/nrcc.yaml
# uses tcp-socket on this same port.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('net').createConnection(8443,'127.0.0.1').once('connect',function(){this.end();process.exit(0);}).once('error',function(){process.exit(1);});"

CMD ["node", "server.js"]
