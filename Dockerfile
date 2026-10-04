# syntax = docker/dockerfile:1

# Node 24 runs the TypeScript server directly (type stripping) and ships
# SQLite (node:sqlite), so the image needs no build step and no native
# modules. The only runtime dependency is `marked`, for /readme/.
FROM docker.io/library/node:24.21.0-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server ./server
COPY public ./public
COPY README.md ./
# images the README links to, served under /readme/docs/
COPY docs ./docs

# /data is the Fly volume (fly.toml); the database lives there
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "server/server.ts"]
