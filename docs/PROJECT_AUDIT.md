# Project Audit

Canonical detailed audit: `../PROJECT_AUDIT.md`.

Current status:

- Maintained frontend: `apps/web` Next.js App Router PWA.
- Maintained backend: `apps/api` NestJS REST/Socket.IO API.
- Database: PostgreSQL via Prisma migrations under `apps/api/prisma/migrations`.
- Runtime services: PostgreSQL, Redis and MinIO through Docker Compose.
- Single Windows launcher: `../START_AVS_APP.bat`.
- Latest verified source backup: `D:\AVS_BACKUPS\final-master-20260719-212416`.
- Fresh DB backup is blocked until Docker CLI or local `pg_dump` is available.
