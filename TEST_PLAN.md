# Test Plan

## Startup

- Run `cmd.exe /c START_AVS_APP.bat --check`.
- Run `START_AVS_APP.bat --no-open` after Docker Desktop is responsive.
- Verify API health at `http://localhost:4000/api/v1/health/live`.
- Verify web login at `http://localhost:3000/login`.
- Confirm only `START_AVS_APP.bat` exists.
- Confirm the displayed LAN IP is not hardcoded.

## Authentication

- Main Admin Devanand logs in.
- Admin-created/reset accounts get `must_change_password=true`.
- First login redirects to `/change-password`.
- Password change sets `must_change_password=false`, `password_changed_at` and `first_login_completed_at`.
- Refresh and relogin do not show the password page again unless an admin reset occurs.

## User Import

- Download student and staff templates.
- Upload `.xlsx` and `.csv` files.
- Verify `.xls` behavior follows the current security policy documented in `USER_IMPORT_GUIDE.md`.
- Map columns, preview, validate, confirm and export one-time credentials.
- Verify duplicate, role, department, programme, section and formula-injection validation.

## Attendance

- Verify CC/HOD marking access and student self-view.
- Verify attendance schedule window uses backend time.
- Verify admin override, correction request and immutable history.
- Confirm attendance tables/cards remain usable on mobile widths.

## Issues and QR

- Submit issue without image.
- Submit issue with camera/gallery image.
- Generate room QR labels.
- Scan room QR through `/scan-qr`.
- Confirm backend validates the QR token and opens `/report-issue`.
- Confirm scanned campus/block/floor/room are preselected and locked.
- Submit QR-origin issue and verify `submissionSource=QR_SCAN`.
- Verify `/admin/qr-management` analytics after scans.

## Announcements

- Create text and image announcements.
- Send to all active users.
- Verify recipient records, in-app delivery, email queueing and non-blocking failures.
- Verify one-time popup display and announcement history.
- Verify view/open/acknowledgement analytics.

## Mobile and PWA

Test widths: `320`, `360`, `375`, `390`, `412`, `768`, `1024`, `1440`.

- No horizontal scrolling.
- Login, password change, attendance, issue report and QR scanner fit.
- Tables collapse or remain scroll-safe.
- PWA manifest, icons, offline page and service worker load.
- Camera test uses HTTPS on phones; see `CAMERA_HTTPS_SETUP.md`.

## Performance and Security

- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm run test -w @college/api`.
- Run `npm run test -w @college/web`.
- Run `npm run build`.
- Run `npm audit --omit=dev --audit-level=high`.
- Review large route bundles and slow API queries if build or runtime timings regress.
