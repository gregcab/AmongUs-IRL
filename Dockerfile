# syntax=docker/dockerfile:1

# ---- Build: install the workspace, build web + server, extract server prod deps ----
FROM node:22-bookworm-slim AS build
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform (e.g. ARM).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
  && pnpm --filter @among-us/server deploy --prod /out/server

# ---- Runtime: Node + built files only ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app

COPY --from=build /out/server/package.json apps/server/package.json
COPY --from=build /out/server/node_modules apps/server/node_modules
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/web/dist apps/web/dist

VOLUME /app/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
