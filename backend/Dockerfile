FROM oven/bun:1.4.2-debian AS dependencies
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS source
COPY backend backend
RUN bun run --cwd backend prisma:generate

FROM source AS migrate
WORKDIR /app/backend
CMD ["bun", "run", "prisma:deploy"]

FROM source AS build
WORKDIR /app/backend
RUN bun run build && test -f dist/main.js

FROM oven/bun:1.4.2-debian AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production --filter @inspector-ai/backend

FROM oven/bun:1.4.2-debian AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
COPY backend/scripts ./backend/scripts
COPY docs/requirements/matrix-132.xlsx ./docs/requirements/matrix-132.xlsx

RUN mkdir -p /data/originals /data/quarantine /data/derived && chown -R bun:bun /data && chmod 700 /data /data/originals /data/quarantine /data/derived

USER bun
EXPOSE 3000
CMD ["bun", "backend/dist/main.js"]

# The offline delivery follows the Node.js runtime required by the specification.
# Bun remains the pinned workspace/package manager used by the build stages.
FROM node:24.16.0-bookworm-slim AS node-runtime-base

FROM migrate AS node-migrate
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=node-runtime-base /usr/local/bin/node /usr/local/bin/node
RUN node --version
CMD ["node", "/app/backend/node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM runtime AS node-runtime
USER root
COPY --from=node-runtime-base /usr/local/bin/node /usr/local/bin/node
RUN node --version
USER bun
CMD ["node", "backend/dist/main.js"]
