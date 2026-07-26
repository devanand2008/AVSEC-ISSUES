# Database Design

## Standards

- PostgreSQL is the only production system of record.
- Prisma maps application models to `snake_case` tables.
- Primary keys are UUIDs. Human-facing identifiers such as issue numbers are separate unique fields.
- Timestamps are stored as `timestamptz`/UTC and rendered in the configured college timezone (`Asia/Kolkata` by default).
- Mutable configuration/master records carry `created_at`, `updated_at`, optional actor IDs, `version`, and optional `deleted_at` where soft deletion is appropriate.
- Histories, audit records, notification attempts and webhook events are append-only.
- Foreign keys default to `RESTRICT`; cascades are used only for private session/token children and explicitly safe join rows.
- Attendance percentages and SLA status are derived from authoritative records/deadlines.

## Domain groups

### Identity and authorization

`users`, `user_credentials`, `sessions`, `refresh_tokens`, `login_attempts`, `password_reset_tokens`, `device_registrations`, `roles`, `permissions`, `role_permissions`, `user_roles`, and `user_scopes`.

Roles grant permissions. `user_scopes` restrict grants through a typed `scope_type` plus the relevant entity ID. Permission evaluation is the intersection of an active account, role permission, and matching resource scope. A user may have multiple roles; maintenance roles do not imply attendance permission.

### College and academics

`colleges`, `campuses`, `departments`, `programmes`, `academic_years`, `semesters`, `sections`, `subjects`, `faculty_subject_assignments`, `student_profiles`, `staff_profiles`, `class_representative_assignments`, and `class_coordinator_assignments`.

Key uniqueness:

- student ID unique per college;
- employee ID unique per college;
- programme code unique per department;
- section code unique per semester/programme context;
- active assignments constrained by date/status and validated transactionally.

### Attendance

`attendance_statuses`, `attendance_sessions`, `attendance_records`, `attendance_correction_requests`, `attendance_change_histories`, and `idempotency_keys`.

- A session binds academic year, section, subject, faculty, date and period.
- `(session_id, student_id)` is unique.
- Draft/submitted/locked state is on the session; records are changed only through the attendance service.
- Corrections store requested and approved values; approval writes an append-only history in the same transaction.
- Idempotency keys bind actor + endpoint + key to request hash/response metadata.

### Locations and assets

`blocks`, `floors`, `rooms`, `room_types`, `asset_categories`, `assets`, and `room_responsible_people`.

- block belongs to campus; floor belongs to block; room belongs to floor.
- room code is unique within campus, enforced through a denormalized/transactionally validated campus reference or a database unique index.
- an asset belongs to one room/registered area and has a unique asset code within college.
- inactive ancestors make descendants unavailable for new issue reports.

### Issues, routing and SLA

`issue_categories`, `issue_types`, `responsible_teams`, `responsible_team_members`, `duty_schedules`, `issue_assignment_rules`, `issue_sla_policies`, `issues`, `issue_affected_users`, `issue_attachments`, `issue_comments`, `issue_status_histories`, `issue_assignment_histories`, `issue_escalations`, and `resolution_verifications`.

Issue creation transaction:

1. validate actor scope, active location/category/type and idempotency key;
2. check duplicate candidates;
3. allocate an issue number using a PostgreSQL sequence;
4. rank active routing rules deterministically;
5. snapshot chosen rule/team/person/reason on the issue;
6. calculate deadlines from the selected SLA policy;
7. insert initial status/assignment history and affected reporter;
8. insert notification/outbox records;
9. commit, then enqueue delivery jobs.

Active duplicate lookup uses room/category/type/asset plus active statuses and a configurable time window. It suggests rather than rejects.

### Notifications and integrations

`notifications`, `notification_recipients`, `device_registrations`, `notification_delivery_attempts`, `whatsapp_messages`, `whatsapp_webhook_events`, `notification_templates`, `outbox_events`, and `background_job_failures`.

`outbox_events.idempotency_key` and delivery provider/message keys are unique. Provider attempts never control the issue transaction. Webhook payloads retain a hash and minimally necessary redacted metadata.

### Messenger and announcements

`conversations`, `conversation_participants`, `messages`, `message_attachments`, `message_read_receipts`, `message_reactions`, `reported_messages`, `announcements`, `announcement_audiences`, and `announcement_read_receipts`.

Conversation membership is queried before message/read/socket access. Messages use soft deletion with edit windows and append-only moderation/audit events. Official-group membership is synchronized from academic/role assignments.

### Administration

`audit_logs`, `app_settings`, `import_jobs`, `export_jobs`, and `background_job_failures`.

Normal application roles receive no update/delete endpoint for audit logs, and PostgreSQL rejects audit updates/deletes. Imports use private object storage and queued jobs; source/result objects retain checksums and row outcomes. Current issue and attendance exports are synchronous, scope-filtered CSV responses.

## Important indexes and constraints

- unique `issues.issue_number` and sequence-backed allocation;
- unique attendance `(session_id, student_id)`;
- unique active user-role-scope mapping;
- unique notification/outbox idempotency keys;
- hierarchy foreign keys with `RESTRICT` deletes;
- indexes on issue status/priority/assignee/location/SLA deadlines;
- indexes on attendance date/section/subject/student;
- indexes on user college ID, employee ID, email/mobile and active status;
- indexes on scope type/entity and role permission;
- indexes on message conversation/created time and notification recipient/read time;
- PostgreSQL full-text/trigram indexes added by SQL migration for authorized global search.

## Soft deletion and retention

Users and master data are disabled/archived instead of physically deleted while referenced. Sessions, histories, issues, audit logs and delivery attempts are retained under the institution's configured policy. Refresh tokens store hashes only and expire/revoke. Password reset tokens store hashes only. Issue attachment deletion is an audited soft delete; storage lifecycle cleanup must be configured operationally.

## Legacy mapping

| Legacy field | Production target | Rule |
| --- | --- | --- |
| student `id` | `student_profiles.legacy_id` | Preserve for reconciliation; never use as authorization ID |
| `rollNo` | `student_profiles.student_id` | Validate uniqueness per college |
| `dept` | `departments.code` | Administrator-approved mapping |
| attendance `date` | `attendance_sessions.session_date` | Parse ISO date in configured timezone |
| attendance `status` | `attendance_statuses.code` | `P→PRESENT`, `A→ABSENT`, `OD→ON_DUTY` |
| `markedBy` | import metadata/history | Do not treat free text as a verified user |

Legacy records lack subject and period. The import requires an explicit target subject/period or a clearly labelled legacy subject; it cannot silently infer them.

## Migration safety

- Initial migration creates new objects only.
- Every later migration is reviewed for `DROP`, table rewrites, nullability and locking impact.
- Pre-migration `pg_dump` and post-migration counts are mandatory outside disposable development databases.
- Prisma migrations may include reviewed SQL for sequences, partial unique indexes, check constraints, triggers or full-text indexes not expressible in the schema.
- Rollback normally means application rollback plus a forward corrective migration; database restore is an incident procedure.
- Four migration directories are delivered. The two dated 15 July 2026 require target deployment verification before release.
