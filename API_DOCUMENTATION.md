# API Documentation

Base path: `/api/v1`  
OpenAPI UI: `/api/docs` when enabled for the environment.

Generated Swagger is authoritative for DTO fields. This file is the human-readable contract and security index.

## Conventions

- JSON is camelCase. IDs are UUIDs; issue numbers are human-facing sequence values.
- Protected browser requests use HttpOnly access/refresh cookies. State-changing requests additionally require an approved origin and CSRF token/header.
- Issue creation and attendance submission require `Idempotency-Key`.
- List endpoints cap `page`/`pageSize`; scope is derived from the session, never trusted from a requested user ID.
- Dates use ISO 8601. Responses include `x-request-id`; errors do not expose SQL, storage keys, stack traces, or secrets.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be validated.",
    "requestId": "request-id",
    "details": [{ "field": "title", "message": "Title is required." }]
  }
}
```

## Route families

| Family                                                                                          | Purpose                                                                             | Main protection                             |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `/auth`                                                                                         | login, refresh, logout, password reset/change, sessions, current user               | rate limit, cookies, CSRF/origin            |
| `/users`, `/roles`, `/permissions`, `/scopes`                                                   | people, status, multi-role and scope administration                                 | RBAC plus tenant/scope                      |
| `/academic`                                                                                     | departments, programmes, academic years, semesters, sections, subjects, assignments | academic permission/scope                   |
| `/attendance`                                                                                   | sessions, roster, draft, submit, corrections, own summary                           | assignment plus attendance permission/scope |
| `/locations`                                                                                    | campus cascade, rooms, assets, QR lookups/sheets/rotation                           | location permission/scope                   |
| `/issue-categories`, `/issue-types`, `/responsible-teams`, `/assignment-rules`, `/sla-policies` | issue configuration and deterministic routing                                       | config/routing permissions                  |
| `/issues`                                                                                       | duplicates, create/list/detail, workflow, comments, files, verification, history    | relation/assignment/scope                   |
| `/conversations`, `/messages`, `/message-reports`                                               | messaging, preferences, search, files, report/moderation                            | active participant or moderator permission  |
| `/announcements`                                                                                | list, draft, publish, archive, acknowledge                                          | audience and publisher scope                |
| `/notifications`                                                                                | inbox/read, encrypted push devices                                                  | own-notification permission                 |
| `/imports`                                                                                      | templates, preview, confirm, progress/results, rollback                             | per-entity import permission                |
| `/reports`                                                                                      | dashboard and scoped CSV exports                                                    | corresponding read/export scope             |
| `/audit-logs`, `/settings`, `/background-jobs`, `/search`                                       | operations, settings, retry/resolve, global search                                  | administration permissions/tenant           |
| `/webhooks/whatsapp`                                                                            | verification and signed status events                                               | public route with provider verification     |
| `/health`                                                                                       | live and dependency readiness                                                       | liveness public; readiness protected        |

## Attendance

```text
POST /attendance/sessions
GET  /attendance/sessions
GET  /attendance/sessions/:id/roster
PUT  /attendance/sessions/:id/draft
POST /attendance/sessions/:id/submit
POST /attendance/sessions/:id/corrections
GET  /attendance/corrections
POST /attendance/corrections/:id/approve
POST /attendance/corrections/:id/reject
GET  /attendance/students/me
GET  /attendance/export
GET  /reports/attendance/export.csv
```

Session creation and marking derive valid subject/section assignments from the authenticated faculty member. Submission requires the complete active roster, records change history, locks the submitted session, and replays safely for the same idempotency key. Approved corrections never overwrite without history.

## Issue reporting and workflow

```text
GET  /issues/duplicates
POST /issues
GET  /issues
GET  /issues/:id
POST /issues/:id/assign
POST /issues/:id/acknowledge
POST /issues/:id/start
POST /issues/:id/status
POST /issues/:id/comments
POST /issues/:id/resolve
POST /issues/:id/verify
POST /issues/:id/reopen
POST /issues/:id/subscribe
GET  /issues/:id/history
POST /issues/:issueId/attachments/presign
POST /issues/:issueId/attachments/complete
GET  /issues/:issueId/attachments/:attachmentId/download
DELETE /issues/:issueId/attachments/:attachmentId
GET  /reports/issues/export.csv
```

Creation validates active location/category/type/asset relationships, checks duplicates, allocates the issue number, evaluates the most specific active routing rule, snapshots the decision, computes working-hours deadlines, writes history, and creates the notification/outbox in one transaction. Provider delivery is asynchronous.

## Location and asset cascade

```text
GET /locations/campuses
GET /locations/blocks?campusId=:id
GET /locations/floors?blockId=:id
GET /locations/rooms?floorId=:id
GET /locations/assets?roomId=:id
GET /locations/rooms/qr/:token
GET /locations/rooms/:id/qr-code
GET /locations/qr-sheet?floorId=:id
POST /locations/rooms/:id/qr-code/rotate
```

QR tokens identify rooms, not users, and may be rotated. Report flow returns active entities; administration endpoints apply their own permissions.

## Messaging

```text
GET    /conversations
POST   /conversations/direct
GET    /conversations/contacts?search=:term
POST   /conversations/sync-official
GET    /conversations/:id/messages?before=:timestamp
POST   /conversations/:id/messages
POST   /conversations/:id/read
PATCH  /conversations/:id/preferences
GET    /conversations/:id/search?q=:term
PATCH  /messages/:id
DELETE /messages/:id
POST   /messages/:id/reactions
DELETE /messages/:id/reactions/:emoji
POST   /messages/:id/report
POST   /messages/:messageId/attachments/presign
POST   /messages/:messageId/attachments/complete
GET    /messages/:messageId/attachments/:attachmentId/download
GET    /message-reports?status=OPEN
PATCH  /message-reports/:id
```

Conversation membership is checked for every REST/file/socket operation. Sender edit/delete/attachment writes expire after 15 minutes. Reported content is visible only with `messages.moderate_reported`; decisions and notes are audited and tenant-scoped.

## Imports

```text
GET  /imports/templates/:entityType
POST /imports/preview
GET  /imports
GET  /imports/:id
POST /imports/:id/confirm
POST /imports/:id/rollback
```

Preview uses multipart field `file` and body field `entityType`. Supported types are `USERS`, `STUDENTS`, `STAFF`, `DEPARTMENTS`, `PROGRAMMES`, `CLASSES`, `BLOCKS`, `FLOORS`, `ROOMS`, `ASSETS`, `RESPONSIBLE_PERSONS`, and `ASSIGNMENT_RULES`. Source/result objects are private. Confirmation is required before background processing. Rollback is rejected when later references make deletion unsafe.

## Notifications and operations

```text
GET    /notifications
POST   /notifications/:id/read
POST   /notifications/read-all
GET    /notifications/devices
POST   /notifications/devices
DELETE /notifications/devices/:id
GET    /background-jobs
POST   /background-jobs/:id/retry
POST   /background-jobs/:id/resolve
GET    /audit-logs
GET    /settings
PUT    /settings/:key
GET    /settings/integrations/status
GET    /search?q=:term
```

Device tokens are encrypted at rest and never returned. Audit and failure queries require matching college ID even for system-created records. Audit update/delete is additionally blocked in PostgreSQL.

## Upload contract

Presign validates relation, permission, purpose, extension, declared MIME, and size. Completion verifies the tenant/resource key prefix, object metadata, bounded object bytes, magic signature, SHA-256, and optional malware scan before storing attachment metadata. Downloads return short-lived private URLs.

## Health

- `GET /health/live`: public process liveness.
- `GET /health/ready/dependencies`: public minimal readiness for container orchestration; returns no dependency configuration.
- `GET /health/ready`: PostgreSQL, Redis, and object-storage readiness for an authenticated `system.health` operator.

# Smart Campus Feedback and Attendance Analytics API

The Smart Campus module adds QR-based feedback, role-scoped analytics and attendance analytics.

Key routes:

- `GET /api/v1/feedback/scan/:token`
- `POST /api/v1/feedback/submit`
- `GET /api/v1/feedback/my-history`
- `GET /api/v1/feedback/dashboard`
- `GET /api/v1/admin/feedback/qr`
- `POST /api/v1/admin/feedback/qr/bulk-generate`
- `GET /api/v1/admin/feedback/qr/:id/download?format=png|svg|poster`
- `GET /api/v1/admin/feedback/submissions`
- `PATCH /api/v1/admin/feedback/submissions/:id/status`
- `GET /api/v1/attendance/staff-summary`
- `GET /api/v1/attendance/class-summary`
- `GET /api/v1/attendance/low-attendance`
- `GET /api/v1/attendance/export`

See [SMART_CAMPUS_FEEDBACK_ATTENDANCE.md](SMART_CAMPUS_FEEDBACK_ATTENDANCE.md) for request/permission details.
