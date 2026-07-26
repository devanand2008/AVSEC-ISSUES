# Final Upgrade Report

Completed: 16 July 2026

## What Changed

- Applied AVS Engineering College identity across login, loading, first-login
  password, app shell, mobile header, metadata, manifest, README, and launch
  scripts.
- Copied the official logo into deployable public assets and generated optimized
  PNG/icon variants.
- Updated the development seed so college code `6201` belongs to AVS Engineering
  College and Main Admin `ADM001` is Devanand with email
  `deva1253@college.com`.
- Removed source fallback for the admin password. The temporary local password is
  read from `DEVELOPMENT_ADMIN_PASSWORD`, and the seeded admin must change it at
  first sign-in.
- Created a fresh PostgreSQL backup before cleanup.
- Deleted the stale `Welcome to CampusOne` announcement.
- Rebuilt and restarted the Docker web service so `http://localhost:3000` serves
  the AVS build.

## Verification

- Database query confirmed AVS Engineering College, code `6201`, Devanand,
  `deva1253@college.com`, and `must_change_password = true`.
- API login confirmed Devanand, role `MAIN_ADMIN`, and `mustChangePassword: true`.
- Browser login confirmed redirect to `http://localhost:3000/change-password`.
- Desktop screenshot: `test-results\avs-login-check.png`.
- Mobile screenshot: `test-results\avs-login-mobile.png`.
- `npm run typecheck -w @college/web`: passed.
- `npm run typecheck -w @college/api`: passed.
- `npm run prisma:validate -w @college/api`: passed.
- `npm run lint -w @college/web`: passed.
- `npm run lint -w @college/api`: passed.
- Docker web production build: passed.

## Known Remaining Work

- Replace remaining sample users, rooms, attendance, and Playwright issue records
  with real AVS master data after cleanup approval.
- Run full regression (`npm run check` plus E2E) after real data import.
- Configure and verify Firebase/WhatsApp only with institution-owned credentials.
- Perform production backup/restore rehearsal and migration smoke tests before
  production deployment.
