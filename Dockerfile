# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV CI=true
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS source

COPY . .

FROM source AS api-build

RUN pnpm --filter @ludico/contracts build \
  && pnpm --filter @ludico/domain build \
  && pnpm --filter @ludico/database build \
  && pnpm --filter @ludico/api build \
  && pnpm --filter @ludico/api deploy --legacy --prod /deploy

FROM node:24-alpine AS api

WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-build --chown=node:node /deploy /app
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM source AS worker-build

RUN pnpm --filter @ludico/contracts build \
  && pnpm --filter @ludico/domain build \
  && pnpm --filter @ludico/database build \
  && pnpm --filter @ludico/worker build \
  && pnpm --filter @ludico/worker deploy --legacy --prod /deploy

FROM node:24-alpine AS worker

WORKDIR /app
ENV NODE_ENV=production
COPY --from=worker-build --chown=node:node /deploy /app
USER node
CMD ["node", "dist/main.js"]

FROM source AS web-build

RUN pnpm --filter @ludico/contracts build \
  && pnpm --filter @ludico/domain build \
  && pnpm --filter @ludico/web build \
  && pnpm --filter @ludico/web deploy --legacy --prod /deploy

FROM node:24-alpine AS web

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /deploy /app
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
