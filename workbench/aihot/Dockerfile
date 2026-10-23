FROM node:24.22.1-trixie-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci --no-audit --no-fund && mkdir -p /data && chown node:node /data
USER node

FROM runtime AS checks
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* && git config --system --add safe.directory /app
RUN npm run build -w @aihot/web
USER node
