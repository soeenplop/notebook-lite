# syntax=docker/dockerfile:1
# NestJS background worker. Build context: repository root.
#   docker build -f docker/worker.Dockerfile -t notebook-lite-worker .
# The runtime includes ffmpeg/ffprobe for joining podcast audio batches.

ARG NODE_IMAGE=node:26.13.0-slim

# --- install: worker workspace deps incl. build tooling ------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/queue/package.json packages/queue/
COPY apps/worker/package.json apps/worker/
RUN npm ci --ignore-scripts --no-audit --no-fund \
      -w @notebook-lite/worker --include-workspace-root

# --- build ---------------------------------------------------------------------
FROM deps AS build
COPY packages packages
COPY apps/worker apps/worker
RUN npm run build -w @notebook-lite/shared -w @notebook-lite/db -w @notebook-lite/ai -w @notebook-lite/queue -w @notebook-lite/worker

# --- production dependencies only ----------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/queue/package.json packages/queue/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @notebook-lite/worker \
 && mkdir -p apps/worker/node_modules

# --- runtime -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# ffmpeg concatenates and re-encodes the podcast MP3 batches; ffprobe measures the duration.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    WORKER_PORT=4001
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
# Versions that differ from the hoisted ones (e.g. undici) are installed next to the workspace.
COPY --from=prod-deps /app/apps/worker/node_modules apps/worker/node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/ai/package.json packages/ai/
COPY --from=build /app/packages/ai/dist packages/ai/dist
COPY --from=build /app/packages/queue/package.json packages/queue/
COPY --from=build /app/packages/queue/dist packages/queue/dist
COPY --from=build /app/apps/worker/package.json apps/worker/
COPY --from=build /app/apps/worker/dist apps/worker/dist
USER node
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.WORKER_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/worker/dist/main.js"]
