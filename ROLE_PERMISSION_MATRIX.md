# Role and Permission Matrix

## Enforcement model

Permissions are action-based (`resource.action`) and are always intersected with active scopes. Frontend navigation is a convenience only; NestJS guards and scoped queries are the security boundary. `college:*` means every resource in an explicitly assigned college, not every tenant. An account may have more than one role.

Scope types: college, campus, department, programme, academic year, semester, section/class, block, floor, room, issue category and assigned issue. The most restrictive applicable data scope wins. Maintenance roles receive no attendance permission unless another explicit role supplies it.

Legend: **M** manage, **V** view, **O** own/assigned only, **C** configured/limited, **—** denied by default.

| Role | Users/RBAC | Academic/location masters | Attendance | Issues | Messenger/announcements | Reports/audit/settings |
| --- | --- | --- | --- | --- | --- | --- |
| Super Admin | M across tenants | M | V/M as configured | M | M official channels | M, including health/integrations/backups |
| Main Admin | M within college | M | V/M administrative scope | M | M authorized audiences | M within college; audit read-only |
| Principal | V | V college | V college | V/approve configured actions | publish college | V college analytics |
| Vice Principal | V | V assigned campuses/college | V assigned scope | V/monitor/escalations | publish authorized scope | V assigned scope |
| HOD | V department | V department | V department | V department rooms/issues | publish department | V department reports |
| Class Coordinator | V assigned class | V assigned class | V/correction workflow assigned class | V assigned classrooms; report | class group/announcements | V assigned class |
| Faculty | V assigned students | V assigned classes/subjects | create/mark/edit window/correct assigned sessions | report; V permitted | permitted class/department | V assigned subjects/classes |
| Class Representative | V assigned class only | V assigned class/rooms | C summary/mark only if configured | report/track class | class group; coordinator channel | C class only |
| Student | O | V permitted class/location lists | O records | report/O subscribed issues | permitted conversations/announcements | O |
| Maintenance Admin | M maintenance accounts/config | V locations/assets | — | M | maintenance groups | V issue/notification reports |
| Maintenance Supervisor | V team | V assigned locations | — | V/assign/update within team scope | maintenance groups | V team performance |
| Electrician | O profile | V assigned locations/assets | — | O electrical/assigned | permitted maintenance/issue chat | O performance |
| Plumber | O profile | V assigned locations/assets | — | O plumbing/assigned | permitted maintenance/issue chat | O performance |
| IT Support Technician | O profile | V assigned locations/assets | — | O IT/network/assigned | permitted maintenance/issue chat | O performance |
| Laboratory Technician | O profile | V assigned labs/assets | — | O lab/assigned | permitted maintenance/issue chat | O performance |
| Housekeeping Staff | O profile | V assigned locations | — | O cleaning/assigned | permitted maintenance/issue chat | O performance |
| Security Staff | O profile | V assigned locations | — | O safety/security/assigned | permitted maintenance/issue chat | O performance |
| Other Responsible Person | O profile | V configured locations/assets | — | O configured category/assigned | permitted issue chat | O performance |

## Core permission catalogue

### Identity and administration

- `users.create`, `users.read`, `users.update`, `users.suspend`, `users.archive`, `users.import`
- `roles.read`, `roles.manage`, `permissions.read`, `permissions.manage`, `scopes.manage`
- `sessions.read_own`, `sessions.revoke_own`, `sessions.revoke_any`
- `audit.read`, `settings.read`, `settings.manage`, `integrations.manage`, `system.health`, `backups.manage`

### Master data

- `academic.read`, `academic.manage`
- `locations.read`, `locations.manage`, `locations.import`, `locations.export`, `locations.qr`
- `assets.read`, `assets.manage`, `assets.import`, `assets.export`

### Attendance

- `attendance.read_own`, `attendance.read_class`, `attendance.read_department`, `attendance.read_college`
- `attendance.session.create`, `attendance.mark`, `attendance.submit`, `attendance.edit_window`
- `attendance.correction.request`, `attendance.correction.approve`
- `attendance.export`

### Issues

- `issues.create`, `issues.read_own`, `issues.read_assigned`, `issues.read_scope`, `issues.read_all`
- `issues.assign`, `issues.acknowledge`, `issues.start`, `issues.update_work`, `issues.resolve`
- `issues.verify`, `issues.reopen`, `issues.reject`, `issues.cancel`, `issues.subscribe`, `issues.export`
- `issue_config.manage`, `routing.manage`, `sla.manage`, `escalations.manage`

### Communication

- `conversations.create_direct`, `conversations.read`, `conversations.manage_official`
- `messages.send`, `messages.edit_own`, `messages.delete_own`, `messages.react`, `messages.report`, `messages.moderate_reported`
- `announcements.read`, `announcements.publish_class`, `announcements.publish_department`, `announcements.publish_college`, `announcements.manage`
- `notifications.read_own`, `notifications.preferences`, `notifications.retry`

## Sensitive transition rules

- Only the assigned/configured responsible person or an authorized supervisor can acknowledge/start/update/resolve an issue.
- Reporters cannot change operational issue status; they may verify/reopen only when configured and related to the issue.
- Only authorized administrators can reject/cancel, and a reason is mandatory.
- Attendance submission validates the faculty assignment from the authenticated user, never request-supplied class/subject IDs alone.
- Correction approvers cannot silently overwrite records; approval creates history.
- Private conversation content is available only to participants, except narrowly scoped reported-content/security investigation workflows with audit logging.
- Class representatives, students and HODs receive scoped database predicates; changing a URL ID must produce not-found/forbidden without leaking resource data.
# Feedback and Attendance Analytics Permissions

| Role | Added permissions |
| --- | --- |
| Student | `feedback.scan`, `feedback.submit`, `feedback.read_own` |
| Class Representative | `feedback.scan`, `feedback.submit`, `feedback.read_own` |
| Faculty | `feedback.read_staff` |
| HOD | `feedback.read_department`, `feedback.read_staff`, `feedback.actions.manage`, `feedback.export` |
| Vice Principal | `feedback.read_college`, `feedback.read_staff`, `feedback.actions.manage`, `feedback.export` |
| Principal | `feedback.read_college`, `feedback.read_staff`, `feedback.actions.manage`, `feedback.export` |
| Main Admin / Super Admin | All feedback permissions |

QR poster downloads require `feedback.qr.download`. Feedback settings require `feedback.settings.manage`.
