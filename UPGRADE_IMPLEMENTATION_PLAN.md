# Upgrade Implementation Plan

Date: 16 July 2026  
Goal: make the existing AVS Engineering College system cleaner, safer, mobile-accessible and verifiable without replacing it with a demo project.

## Completed

1. Audited the existing stack: Next.js web, NestJS API, PostgreSQL, Redis and MinIO.
2. Preserved the Devanand Main Admin account: `deva1253@college.com`, college code `6201`.
3. Created verified database and project backups before destructive cleanup.
4. Added `scripts/cleanup-demo-data.ts` with dry-run, confirmation, transaction safety and audit logging.
5. Executed confirmed cleanup against known demo/sample records.
6. Removed a duplicate non-admin Devanand test/student account.
7. Fixed repeated password-change behavior by keeping the Main Admin account at `must_change_password=false`.
8. Added Docker/LAN binding controls for web/API while keeping database, Redis and MinIO on localhost.
9. Replaced old Windows launchers with `START_AVS_APP.bat` as the single main Windows LAN startup script.
10. Added CORS allowlist support for the detected LAN frontend URL.
11. Added web runtime URL fallback for LAN phone access.
12. Verified local and LAN browser login/attendance smoke tests.

## Validation Plan

Run before handoff:

```powershell
npm run prisma:validate -w @college/api
npm run typecheck -w @college/api
npm run typecheck -w @college/web
npm run lint -w @college/api
npm run lint -w @college/web
npm run cleanup:data -- --dry-run
docker compose --profile full up -d --force-recreate api web
docker compose ps
```

Browser smoke test:

- Login as Devanand.
- Verify no forced password-change loop appears.
- Open Admin Attendance.
- Confirm class-student entry/attendance UI loads.
- Confirm desktop layout and mobile viewport do not show horizontal overflow.

## Remaining Deployment Gates

- Institution SMTP/Firebase/WhatsApp credentials are needed for live delivery acceptance tests.
- Production must use strong secrets, TLS, exact CORS origins and encrypted off-host backups.
- Campus staff should review retained master data before any physical deletion of departments, sections, rooms or official group channels.
- Full Docker image rebuild should be rerun after Docker Buildx is healthy; the local images are currently refreshed from verified local build output.
