# syntax=docker/dockerfile:1
# NestJS API. Build context: repository root.
#   docker build -f docker/api.Dockerfile -t notebook-lite-api .

ARG NODE_IMAGE=node:26.13.0-slim

# --- install: api workspace deps incl. build tooling ---------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts --no-audit --no-fund \
      -w @notebook-lite/api --include-workspace-root

# --- build ---------------------------------------------------------------------
FROM deps AS build
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @notebook-lite/shared -w @notebook-lite/db -w @notebook-lite/api

# --- production dependencies only ----------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @notebook-lite/api

# --- runtime -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_PORT=4000
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
