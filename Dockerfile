FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

FROM dependencies AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_SOCKET_URL=/realtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run build -w @college/shared-types \
    && npm run build -w @college/validation \
    && npm run build -w @college/api \
    && npm run build -w @college/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_PORT=4000
ENV WEB_INTERNAL_PORT=3000
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl postgresql-client tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/backups \
    && chown -R node:node /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build --chown=node:node /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build --chown=node:node /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /app/packages/validation/package.json ./packages/validation/package.json
COPY --from=build --chown=node:node /app/packages/validation/dist ./packages/validation/dist
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/scripts/render-start.sh ./scripts/render-start.sh
COPY --from=build --chown=node:node /app/scripts/unified-server.mjs ./scripts/unified-server.mjs
COPY --from=build --chown=node:node /app/scripts/assert-migration-safety.mjs ./scripts/assert-migration-safety.mjs
COPY --from=build --chown=node:node /app/scripts/backup-crypto.mjs ./scripts/backup-crypto.mjs
COPY --from=build --chown=node:node /app/scripts/test-sql-restore.sh ./scripts/test-sql-restore.sh

USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "scripts/render-start.sh"]
