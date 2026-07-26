# Performance Audit

Date: 16 July 2026

## Current Performance Shape

- Web is built with Next.js route splitting.
- API uses scoped/paginated database access for major lists.
- Dashboard values come from database queries, not static fake numbers.
- Logo/icon assets are optimized for web/PWA use.
- Redis/BullMQ handles background delivery work.
- Docker health checks are present for API, web and infrastructure services.
- Cleanup removed demo issues/users/notifications that inflated dashboard and list counts.

## Risks Found

- First request after container restart is slower because Next.js/API warm up.
- Live notification/email provider performance cannot be measured without institution-owned credentials.
- Very large imports still need operator monitoring through the import/operations screens.

## Actions Taken

- Removed unnecessary demo data to reduce list/dashboard load.
- Kept PostgreSQL as the authoritative database.
- Preserved Redis for background jobs and stable queue behavior.
- Added LAN startup that avoids exposing database infrastructure.
- Avoided duplicate local startup scripts; `START_AVS_APP.bat` supports `--skip-build` when a rebuild is not needed and keeps data services on localhost.

## Recommended Ongoing Checks

```powershell
npm run build -w @college/api
npm run build -w @college/web
npm run audit:production
```

Measure warm login, dashboard, attendance, issue submission and announcement flows after production secrets and provider credentials are configured.

Latest browser smoke confirmed local and LAN attendance pages load without horizontal overflow at 1366px desktop and 390px mobile widths.
