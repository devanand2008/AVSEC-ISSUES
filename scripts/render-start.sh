#!/bin/sh
set -eu

node apps/api/dist/config/validate-production.js
node scripts/assert-migration-safety.mjs
npm exec --workspace=@college/api -- prisma migrate deploy --schema=prisma/schema.prisma
exec node scripts/unified-server.mjs
