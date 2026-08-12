FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY scripts/assert-secure-dependency-tree.mjs scripts/assert-secure-dependency-tree.mjs
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund \
    && npm run security:dependencies \
    && npm ls @nestjs/swagger js-yaml nanoid --all

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

FROM node:22-bookworm-slim AS runtime
ARG POSTGRES_CLIENT_MAJOR=17
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_PORT=4000
ENV WEB_INTERNAL_PORT=3000
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl tini \
    && install -d -m 0755 /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error --location \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends "postgresql-client-${POSTGRES_CLIENT_MAJOR}" \
    && pg_dump --version | grep -Eq '^pg_dump \(PostgreSQL\) (1[7-9]|[2-9][0-9])\.' \
    && psql --version | grep -Eq '^psql \(PostgreSQL\) (1[7-9]|[2-9][0-9])\.' \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/backups \
    && chown -R node:node /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/src/generated/prisma ./apps/api/src/generated/prisma
COPY --from=build --chown=node:node /app/apps/api/src/modules/academic/avs-academic-structure.ts ./apps/api/src/modules/academic/avs-academic-structure.ts
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

RUN test -f /app/apps/api/src/modules/academic/avs-academic-structure.ts \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
      DEVELOPMENT_ADMIN_EMAIL=build-check@example.invalid \
      DEVELOPMENT_ADMIN_PASSWORD='BuildCheckOnlyPassword123!' \
      node_modules/.bin/tsx --eval \
      "import('./apps/api/prisma/seed.ts').then(() => process.stdout.write('bootstrap dependency graph resolved.\\n'))"

USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "scripts/render-start.sh"]
