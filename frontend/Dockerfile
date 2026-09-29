FROM oven/bun:1.4.2-debian AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile

COPY frontend frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run --cwd frontend build

FROM nginx:1.29.1-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

FROM runtime AS offline-runtime
RUN apk add --no-cache iptables setpriv
COPY --chmod=0555 frontend/offline-entrypoint.sh /usr/local/bin/offline-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/offline-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/offline-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

# An ordinary build retains the existing runtime and needs no NET_ADMIN.
FROM runtime AS default-runtime
