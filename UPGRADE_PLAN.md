# AVS Upgrade Plan

Updated: 19 July 2026

## Completed in Final Master Pass

- Created verified source/config backup under
  `D:\AVS_BACKUPS\final-master-20260719-212416`.
- Consolidated Windows startup to one file: `START_AVS_APP.bat`.
- Removed obsolete root BAT files and nested legacy BAT helpers; only
  `START_AVS_APP.bat` remains.
- Added `START_AVS_APP.bat --check` for non-destructive launcher validation.
- Added exact required documentation filenames for BAT, test plan, QR/camera,
  PWA, login/password, announcement and camera HTTPS setup.
- Added `scripts/cleanup-unnecessary-data.ts` and mapped `cleanup:data` to it.
- Removed disconnected root legacy Vite app files and the direct root `vite`
  dev dependency.
- Re-ran typecheck, lint, API tests, web tests, Prisma validation, production
  build and production high-severity audit.

## Remaining Blockers

- Fresh database backup could not be created because local `pg_dump` is not
  installed and Docker CLI calls timed out.
- Confirmed data cleanup is intentionally blocked until a fresh PostgreSQL dump
  is created and verified.
- Full double-click startup through `START_AVS_APP.bat` could not be completed
  while Docker CLI was unresponsive; `--check` passed.
- The large `worker management system2` legacy folder remains documented as
  removable because local policy blocked recursive deletion.

## Completed in This Pass

- Copied the AVS Engineering College logo into public web assets and generated
  optimized PWA/icon variants.
- Added reusable AVS branding components for login, loading, sidebar, mobile
  topbar, and first-login password screens.
- Updated metadata, manifest, theme color, README, and launch scripts from
  CampusOne-style wording to AVS Engineering College.
- Changed the development seed to configure college code `6201`, the Main Admin
  identity from protected environment values, and first-login password change.
- Removed source fallback for the admin password; it now comes from
  `DEVELOPMENT_ADMIN_PASSWORD`.
- Took a fresh database backup before cleanup and seeding.
- Removed the stale `Welcome to CampusOne` announcement.
- Rebuilt and restarted the Docker web service so `http://localhost:3000` serves
  the AVS build.

## Near-Term Next Steps

1. Approve the database cleanup set in `DATABASE_CLEANUP_PLAN.md`.
2. Replace development users and sample academic/location data with institution
   CSV/XLSX imports, keeping Devanand as the first Main Admin.
3. Run the full regression suite after cleanup: `npm run check` and web E2E.
4. Connect institution Firebase/WhatsApp credentials if provider delivery is
   required.
5. Perform production deployment only after production secrets, TLS, backup,
   restore rehearsal, migration review, and provider smoke tests are complete.

## Release Gate

Do not run destructive cleanup or production deployment from the local seed alone.
Use a fresh backup, reviewed SQL/API cleanup script, and a restore-tested database
for any environment that may contain real college data.
