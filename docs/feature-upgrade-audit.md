# Feature upgrade audit

Audit date: 27 July 2026. No secret values were inspected or copied into this document.

## Application structure

- PWA frontend: `apps/web`, using Next.js 16, React 19, TypeScript, a web manifest, service-worker registration and responsive portal routes.
- Backend API: `apps/api`, using NestJS 11 and TypeScript.
- Database: PostgreSQL through Prisma 7.8. The schema is `apps/api/prisma/schema.prisma`; migrations are in `apps/api/prisma/migrations`.
- Authentication: JWT/passport authentication with user status, college identity and permission guards. Archived and suspended users are excluded from active access.
- Authorisation: database-backed roles and permissions, college-scoped service queries, and location/department scopes.

## Current feature findings

### Announcements

The announcement module is in `apps/api/src/modules/announcements`; the admin and recipient PWA pages are under `apps/web/src/app/(portal)/admin/announcements` and `apps/web/src/app/(portal)/announcements`.

The title is a standalone string and is mapped through create, update, list, detail, notification and receipt flows. The PWA displays it on admin and recipient views. The discovered contract mismatch was a 3–180 character limit. This upgrade changes it to a trimmed, Unicode-capable 2–200 character value and rejects angle-bracket HTML markup. Category remains separate. Existing records use a required title in the current schema; presentation code must continue to use `Announcement` as the compatibility fallback when consuming legacy/null external data.

### People

People administration is implemented by `apps/api/src/modules/users` and `apps/web/src/app/(portal)/admin/users`. It supports active/archived filtering, suspend, archive, restore, a college-scoped dependency report, and guarded permanent deletion. Permanent deletion requires Main Admin/Super Admin permission, an already archived account, a reason, backup reference and confirmation phrase; retained dependencies block deletion. Status changes are audited and active sessions are revoked through the authentication/session model.

The compatibility API exposes `/admin/people/:id/archive`, `restore`, `suspend`, `dependencies` and `permanent`, plus controlled bulk archive, restore and suspend. The responsive People UI exposes archive/restore, dependency preview and safe deletion on desktop and mobile.

### Campus setup

Campus, block, floor and room administration is implemented by `apps/api/src/modules/locations` and the admin locations PWA page. Each entity has `isActive`, `archivedAt` and an explicit `isTestData` flag. The service provides test-data filtering, dependency reports, archive, restore, guarded permanent deletion and bulk archive/restore, with college-scope checks and audit records. Records are selected by database ID and college scope, never by name matching.

### Issues and maintenance

Issues are implemented in `apps/api/src/modules/issues` and the PWA issue/report routes. Categories and issue types are database-backed. Routing rules map location/category/type/asset/priority to teams and primary, backup and escalation users. Issue numbers are non-database public identifiers.

Probable duplicates are matched in the backend against active issues at the same location/category/type/asset. A repeat report is linked atomically to the master issue, saved as an `IssueOccurrence`, added to the affected-reporter set idempotently, and increments `occurrenceCount` while updating `lastReportedAt`. Admins may still explicitly create a separate issue. New public identifiers use `AVS-ISS-YYYY-NNNNNN`; workflow routes accept both public identifiers and legacy UUID references with college-scope enforcement.

The status model includes new, assignment, acknowledgement, in-progress, waiting/on-hold, resolution, verification, closed, reopened, rejected and cancelled states. Status history records actor, old/new state, comment, request ID, IP and user agent. SLA deadlines, escalation levels, deduplication keys, assignment history and notification deliveries exist. SLA `resolutionDueAt` remains separate from the staff-entered `expectedCompletionAt`. `IssueTimeline` preserves revisions without overwriting history. `IssueResolution` records the resolution note, required completion photo, parts/cost metadata, completer and verification time.

### WhatsApp

Delivery and WhatsApp integration are backend-only under `apps/api/src/modules/delivery`. Configuration is read from environment variables; tokens are not returned to the PWA. Notification/delivery attempts preserve queued, sent, delivered/read and failed lifecycle states. A manual authorised WhatsApp link is available as fallback. Provider acceptance is not treated as delivery confirmation.

### Feedback QR

Feedback is implemented in `apps/api/src/modules/feedback`, with generic QR validation in `apps/api/src/modules/qr`. The PWA scanner components are in `apps/web/src/components/qr`; feedback deep links resolve under the token route in `apps/web/src/app/(portal)/student/feedback/target/[token]`.

Feedback QR values are opaque tokens stored as hashes. Resolve/scan/submit revalidate target, status and scope server-side. Scanner input supports camera and gallery/manual fallback. Camera use requires HTTPS (or localhost); the UI supplies secure-context guidance when camera access is unavailable. Next.js routing supplies deep-link refresh handling.

Canonical PWA aliases `/feedback/scanner` and `/feedback/scan/[token]` use the same hardened scanner and target form. API aliases `/feedback/qr/:token/resolve`, `scan` and `submit` derive the target from the secure token; the frontend cannot replace the target ID.

## Files and migration impact

The principal implementation areas are:

- `apps/api/src/modules/announcements`
- `apps/api/src/modules/users`
- `apps/api/src/modules/locations`
- `apps/api/src/modules/issues`
- `apps/api/src/modules/delivery`
- `apps/api/src/modules/feedback`
- `apps/api/src/modules/qr`
- `apps/web/src/app/(portal)`
- `apps/web/src/components/qr`
- `apps/api/prisma/schema.prisma`

This upgrade uses additive migrations `20260727120000_announcement_title_200` and `20260727143000_maintenance_workflow`. The latter adds campus test-data flags, issue occurrences and counters, immutable repair timeline revisions and resolution evidence metadata. No reset or destructive database push is required.

## Existing verification coverage

API tests cover role/college boundaries, issue duplicate subscription and assignment delivery, SLA and escalation calculations, WhatsApp provider/retry behavior, feedback token hardening, QR validation and deep-link destinations. PWA tests cover portal access, responsive layout and campus upgrade routes. Full database-connected and camera/WhatsApp provider end-to-end verification still requires configured test infrastructure, HTTPS and provider credentials.
