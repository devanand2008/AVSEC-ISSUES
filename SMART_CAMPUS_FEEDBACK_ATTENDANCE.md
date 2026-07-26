# Smart Campus Feedback and Attendance Analytics

## Scope

This module is integrated into the existing AVS College Management System. It reuses the current `users`, `student_profiles`, `staff_profiles`, departments, locations, academic years, semesters and attendance records.

## Setup

1. Apply database migrations:
   ```powershell
   npm run prisma:deploy -w @college/api
   ```
2. Regenerate Prisma client:
   ```powershell
   npm run prisma:generate -w @college/api
   ```
3. Seed default permissions, questions, cycle, targets and sample QR codes:
   ```powershell
   npm run seed -w @college/api
   ```
4. Start the system:
   ```powershell
   npm run dev
   ```

## API Routes

Student and management:

- `GET /api/v1/feedback/scan/:token`
- `POST /api/v1/feedback/submit`
- `GET /api/v1/feedback/my-history`
- `GET /api/v1/feedback/targets`
- `GET /api/v1/feedback/targets/:id`
- `GET /api/v1/feedback/dashboard`
- `GET /api/v1/feedback/staff/:staffId/analytics`
- `GET /api/v1/feedback/department/:departmentId/analytics`
- `GET /api/v1/feedback/location/:targetId/analytics`
- `GET /api/v1/feedback/submissions`

Admin:

- `GET /api/v1/admin/feedback/dashboard`
- `GET|POST /api/v1/admin/feedback/qr`
- `POST /api/v1/admin/feedback/qr/bulk-generate`
- `GET /api/v1/admin/feedback/qr/:id/download?format=png|svg|poster`
- `PATCH /api/v1/admin/feedback/qr/:id/status`
- `POST /api/v1/admin/feedback/qr/:id/regenerate`
- `GET /api/v1/admin/feedback/submissions`
- `GET /api/v1/admin/feedback/submissions/:id`
- `PATCH /api/v1/admin/feedback/submissions/:id/status`
- `POST /api/v1/admin/feedback/submissions/:id/assign`
- `POST /api/v1/admin/feedback/submissions/:id/resolve`
- `GET|PUT /api/v1/admin/feedback/settings`
- `GET /api/v1/admin/feedback/reports/export.csv`

Attendance analytics:

- `GET /api/v1/attendance/staff-summary`
- `GET /api/v1/attendance/staff/:staffId`
- `GET /api/v1/attendance/class-summary`
- `GET /api/v1/attendance/class/:classId/students`
- `GET /api/v1/attendance/low-attendance`
- `GET /api/v1/attendance/student/:studentId`
- `GET /api/v1/attendance/export`

## Permissions

- Students: `feedback.scan`, `feedback.submit`, `feedback.read_own`
- Faculty: `feedback.read_staff`
- HOD: `feedback.read_department`, `feedback.read_staff`, `feedback.actions.manage`, `feedback.export`
- Principal and Vice Principal: `feedback.read_college`, `feedback.read_staff`, `feedback.actions.manage`, `feedback.export`
- Admin: all feedback permissions, including `feedback.qr.manage`, `feedback.qr.download`, `feedback.settings.manage`

## QR Codes

QR payloads contain only opaque tokens such as `FB_xxx`. The API hashes tokens with SHA-256 in `feedback_qr_codes.secure_token_hash`; raw internal target IDs are not accepted from the browser for scan validation.

Admin QR actions are available at `/admin/feedback/qr-management`.

Official poster downloads are SVG A4 posters with AVS branding and a large scannable QR image. PNG and SVG QR downloads are also available.

## Camera Setup

The scanner page is `/student/feedback/scanner`. Browser camera APIs require HTTPS in production or `localhost` during development. Mobile devices default to the rear camera when the browser exposes a rear-camera label.

## Notifications

Critical and high-priority feedback creates in-app notifications and outbox events for Admin, Principal, Vice Principal and scoped HOD users. The existing delivery worker can dispatch configured push, email and WhatsApp channels when provider settings are enabled. Live external provider dispatch was not exercised in this verification pass.

WhatsApp uses the existing WhatsApp Business API environment:

- `WHATSAPP_ENABLED`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

## Database Tables Added

- `feedback_targets`
- `feedback_qr_codes`
- `feedback_cycles`
- `feedback_questions`
- `feedback_submissions`
- `feedback_ratings`
- `feedback_actions`
- `feedback_notifications`
- `feedback_scan_logs`

## Files Created

- `apps/api/prisma/migrations/20260718213500_feedback_attendance_analytics/migration.sql`
- `apps/api/src/modules/feedback/admin-feedback.controller.ts`
- `apps/api/src/modules/feedback/dto/feedback.dto.ts`
- `apps/api/src/modules/feedback/feedback.controller.ts`
- `apps/api/src/modules/feedback/feedback.module.ts`
- `apps/api/src/modules/feedback/feedback.service.ts`
- `apps/web/src/components/feedback/feedback-ui.tsx`
- `apps/web/src/app/(portal)/student/feedback/form/[targetId]/page.tsx`
- Student, faculty, HOD, Vice Principal, Principal and Admin route pages under `apps/web/src/app/(portal)`
- `SMART_CAMPUS_FEEDBACK_ATTENDANCE.md`

## Files Modified

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/attendance/attendance.controller.ts`
- `apps/api/src/modules/attendance/attendance.module.ts`
- `apps/api/src/modules/attendance/attendance.service.ts`
- `apps/api/src/modules/delivery/delivery.service.ts`
- `apps/api/src/modules/reports/reports.module.ts`
- `apps/web/package.json`
- `package-lock.json`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/core.spec.ts`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/navigation.ts`
- `.env.example`
- `API_DOCUMENTATION.md`
- `ROLE_PERMISSION_MATRIX.md`
- `DEPLOYMENT.md`
- `TEST_REPORT.md`

## User Guides

Student:

- Open `/student/feedback/scanner`.
- Start the camera and scan an official QR code.
- Use manual target search when scanning is unavailable; direct target selections open `/student/feedback/form/:targetId`.
- Complete star ratings and comments.
- Submit and save the reference number shown on success.
- View previous submissions at `/student/feedback/history`.

Faculty:

- Open `/faculty/my-feedback` for own rating summaries.
- Open `/faculty/my-attendance` for attendance analytics derived from submitted attendance sessions.

HOD:

- Open `/hod/feedback-dashboard`, `/hod/staff-ratings`, `/hod/attendance` or `/hod/low-attendance`.
- Data is restricted to assigned department scope.

Principal and Vice Principal:

- Use the role-specific feedback dashboard, attendance analytics and low-attendance pages.
- Principal also has `/principal/management-insights`.

Admin:

- Use `/admin/feedback/qr-management` to bulk-generate, download, regenerate, activate and disable QR codes.
- Use `/admin/feedback/submissions` for review and status workflow.
- Use `/admin/feedback/settings` to configure attendance thresholds and feedback visibility.
- Use `/admin/feedback/reports` for CSV exports.

## Security Checklist

- Authenticated routes are protected by global JWT, CSRF, rate-limit and permission guards.
- QR scan validation uses hashed opaque tokens.
- Target UUIDs are public; internal database IDs are not required from students.
- Duplicate submission rules are enforced on the backend.
- HOD analytics are scoped to assigned departments.
- Staff comments are hidden unless management or settings permit visibility.
- Student identity is masked unless management visibility is enabled or the caller manages settings.
- QR downloads require `feedback.qr.download`.
- Audit logs record QR creation, download, regeneration, status changes, feedback submission, status changes, assignments, exports and settings changes.

## Verification Checklist

- Root `npm run check` succeeds.
- Prisma schema validates.
- Prisma client generation succeeds.
- API typecheck succeeds.
- Web typecheck succeeds.
- API lint succeeds.
- Web lint succeeds.
- API Jest suite succeeds.
- Web Vitest suite succeeds.
- API production build succeeds.
- Web production build succeeds.
- Browser Playwright E2E succeeds with 3 passed tests and 1 intentional mobile API lifecycle skip.
- Local database migrations are applied through `20260718213500_feedback_attendance_analytics`.
- Development seed creates default feedback permissions, questions, cycle, targets and QR rows.
- Database backup was created before migration work.
- Source snapshot was created before edits.
