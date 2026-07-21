FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN npm ci

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN npm ci --omit=dev
RUN test -x node_modules/.bin/prisma

FROM dependencies AS build
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=$DATABASE_URL
COPY . .
RUN npm run prisma:generate && npm run build -w @college/shared-types && npm run build -w @college/validation && npm run build -w @college/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S college && adduser -S college -G college

# Production node_modules (includes Prisma runtime, pg driver, etc.)
COPY --from=production-dependencies --chown=college:college /app/node_modules ./node_modules

# Compiled API application
COPY --from=build --chown=college:college /app/apps/api/dist ./apps/api/dist

# Prisma generated client (required at runtime for the pg adapter)
COPY --from=build --chown=college:college /app/apps/api/src/generated ./apps/api/src/generated

# Prisma schema and migrations (required for prisma migrate deploy in production)
COPY --from=build --chown=college:college /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=college:college /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build --chown=college:college /app/apps/web/public/images/avs-logo-360.png ./logo/logo.png

# Package manifests (npm workspace resolution)
COPY --from=build --chown=college:college /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=college:college /app/package.json ./package.json

# Built shared packages (required by compiled API imports)
COPY --from=build --chown=college:college /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=college:college /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build --chown=college:college /app/packages/validation/dist ./packages/validation/dist
COPY --from=build --chown=college:college /app/packages/validation/package.json ./packages/validation/package.json

USER college
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
