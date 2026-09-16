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

USER bun
EXPOSE 3000
CMD ["bun", "backend/dist/main.js"]
