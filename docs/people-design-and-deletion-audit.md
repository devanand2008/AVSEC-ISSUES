# People Management Design & Deletion Audit

> **Generated:** 2026-07-31  
> **Project:** AVS College Management System v2.0.0  
> **Repository:** devanand2008/AVSEC-ISSUES  

---

## 1. Project Architecture

| Layer | Location | Technology |
|-------|----------|-----------|
| Frontend (PWA) | `apps/web/` | Next.js 16.2.12, React, TanStack Query, Lucide icons |
| Backend (API) | `apps/api/` | NestJS, Prisma ORM, PostgreSQL |
| Shared Types | `packages/shared-types/` | TypeScript |
| Validation | `packages/validation/` | class-validator, class-transformer |
| Prisma Schema | `apps/api/prisma/schema.prisma` | 3,512 lines, 100+ models |
| CSS | `apps/web/src/app/globals.css` | TailwindCSS + vanilla CSS, 5,871 lines |
| Build | Monorepo with npm workspaces | Node ≥22 |

---

## 2. Current People Page Design

**Route:** `/admin/users` → `apps/web/src/app/(portal)/admin/users/page.tsx` (1,844 lines)

### Current state:
- Single monolithic page component (~71 KB)
- Desktop table layout with basic columns
- Inline create-user form with student/staff profile creation
- Search by text, filter by role/status/first-login
- Action buttons: Archive, Suspend, Activate, Reset Password, Verify/Reject Profile, Role History
- Has permission checks (`users.read`, `users.create`, `users.suspend`, `users.delete_permanent`, etc.)
- `DeleteUserDto` exists: requires `confirmationPhrase` + `backupReference`

### Problems:
1. **71 KB single component** — entire page logic, table, forms, modals all in one file
2. **No mobile card layout** — desktop table on phone is cramped/unreadable
3. **No responsive bottom-sheet filters** — dropdowns unusable on small screens
4. **No pagination UI** — fetches 100 users at once, no server-side pagination controls
5. **No dependency dialog** — Admin cannot see what data would be affected before deletion
6. **No lazy-loading** of student details/sections
7. **Hardcoded status badge colours** without accessible alternatives (icon/text)
8. **No empty/error states** with illustrations
9. **No loading skeletons** — just a spinner

---

## 3. Current Mobile Problems

| Issue | Impact |
|-------|--------|
| Desktop table on 320-430px screens | Horizontal scroll, clipped cells |
| Sidebar is hamburger-only | No bottom navigation for admin pages |
| Profile menu dropdown clips on phone | Popover extends beyond viewport |
| Filter dropdowns are desktop-style | No bottom-sheet on mobile |
| Touch targets under 44px | Small icon buttons hard to tap |
| No mobile-optimised form layout | Multi-column forms on phone |
| Create user form is a dialog/inline | Full-page form needed on phone |
| Action buttons in table rows | Too many small actions in a row |

---

## 4. Current Student Delete Behaviour

### Backend (`UsersController`):
```
DELETE /api/v1/admin/people/:publicId/permanent
```
- Permission: `users.delete_permanent`
- DTO: `DeleteUserDto` — requires `reason`, `confirmationPhrase`, `backupReference`
- Controller method: `deletePerson()` → calls `users.deletePermanently()`

### Service analysis:
- The `users.service.ts` (75 KB, 1,165 lines) does **not yet contain** a `deletePermanently()` or `dependencyReport()` method — these are referenced in the controller but **the implementation is missing/incomplete**
- The controller references are wired but the actual deletion logic needs to be fully implemented

### Existing archive support:
- `AccountStatus` enum already has: `PENDING`, `ACTIVE`, `SUSPENDED`, `DISABLED`, `GRADUATED`, `RESIGNED`, `ARCHIVED`
- `User.archivedAt` timestamp field exists
- Archive/Restore endpoints exist and work
- Session revocation endpoint exists

### Existing backup system:
- Full `DatabaseBackup` model with encryption, checksums, manifests
- `BackupManifest` model with record counts, schema version
- `BackupRestoreTest` model for verification
- Backup types include `PRE_DELETION`
- Google Drive integration for backup storage
- `backup-crypto.service.ts`, `backup-manifest.service.ts`, `backups.service.ts` all exist
- Encryption: AES-256-GCM

### Existing audit log:
- `AuditLog` model with actor, action, entityType, entityId, before/after values, reason, requestId, IP, user agent
- `AuditService` exists with `record()` method supporting transactions

### Existing data maintenance:
- `DataMaintenanceJob` model exists with dry-run/confirmation support
- `ArchivedRecord` model exists for tracking archive metadata

---

## 5. Student-Related PostgreSQL Tables

### Direct User Relations (onDelete behaviour):

| Table | FK Field | onDelete |
|-------|----------|----------|
| `UserCredential` | `userId` | **Cascade** |
| `Session` | `userId` | **Cascade** |
| `RefreshToken` | `sessionId` | Cascade (via Session) |
| `LoginAttempt` | `userId` | **SetNull** |
| `PasswordResetToken` | `userId` | **Cascade** |
| `DeviceRegistration` | `userId` | **Cascade** |
| `UserRole` | `userId` | **Cascade** |
| `UserScope` | `userId` | **Cascade** |
| `StudentProfile` | `userId` | **Restrict** ⚠️ |
| `StaffProfile` | `userId` | **Restrict** ⚠️ |
| `SectionMembership` | `studentUserId` | **Restrict** ⚠️ |
| `AttendanceRecord` | `studentUserId` | **Restrict** ⚠️ |
| `AttendanceSummary` | `studentUserId` | **Restrict** ⚠️ |
| `AttendanceIntervention` | `studentUserId` | **Restrict** ⚠️ |
| `Issue` (reporter) | `reporterId` | **Restrict** ⚠️ |
| `Issue` (assignee) | `assignedToId` | **Restrict** ⚠️ |
| `IssueOccurrence` | `reporterUserId` | **Restrict** ⚠️ |
| `IssueComment` | `authorId` | **Restrict** ⚠️ |
| `IssueAttachment` | `uploadedById` | **Restrict** ⚠️ |
| `IssueStatusHistory` | `changedById` | **Restrict** ⚠️ |
| `IssueAffectedUser` | `userId` | **Restrict** ⚠️ |
| `ConversationParticipant` | `userId` | **Cascade** |
| `Message` | `senderId` | **Restrict** ⚠️ |
| `MessageReadReceipt` | `userId` | **Cascade** |
| `MessageReaction` | `userId` | (via Message Cascade) |
| `ReportedMessage` | `reportedById` | **Restrict** ⚠️ |
| `Announcement` | `authorId` | **Restrict** ⚠️ |
| `AnnouncementReadReceipt` | `userId` | **Cascade** |
| `NotificationRecipient` | `userId` | **Cascade** |
| `FeedbackSubmission` | `studentUserId` | **Restrict** ⚠️ |
| `FeedbackScanLog` | `studentUserId` | **SetNull** |
| `FeedbackTarget` (staff) | `staffUserId` | **Restrict** ⚠️ |
| `FileRecord` | `uploadedById` | **Restrict** ⚠️ |
| `AiConversation` | `userId` | **Cascade** |
| `AiUsageRecord` | `userId` | **Cascade** |
| `AiToolExecution` | `userId` | **Cascade** |
| `AiFeedback` | `userId` | **Cascade** |
| `AiSafetyEvent` | `userId` | **Cascade** |
| `AiUserSetting` | `userId` | **Cascade** |
| `StudentProgress` | `studentId` | (no User FK, uses UUID) |
| `AssessmentResult` | `studentId` | (no User FK, uses UUID) |
| `LearningBookmark` | `studentId` | (no User FK, uses UUID) |
| `LearningCertificate` | `studentId` | (no User FK, uses UUID) |
| `SubjectResourceView` | `userId` | **Cascade** |
| `BroadcastRecipient` | `userId` | (via Broadcast Cascade) |
| `QrScanEvent` | `userId` | **SetNull** |

### Key insight:
- **18 tables use `onDelete: Restrict`** — meaning a raw `DELETE FROM users` will fail with FK errors
- This is correct safety behaviour: the schema prevents accidental data loss
- **Deletion requires explicit handling of each restricted relation**

---

## 6. Required Foreign-Key Handling

### DELETE eligible (cascaded or ephemeral):
- `UserCredential` — auto-cascades
- `Session` + `RefreshToken` — auto-cascades
- `PasswordResetToken` — auto-cascades
- `DeviceRegistration` — auto-cascades
- `UserRole`, `UserScope` — auto-cascades
- `ConversationParticipant` — auto-cascades (but preserves conversation)
- `NotificationRecipient` — auto-cascades
- `AnnouncementReadReceipt` — auto-cascades
- `MessageReadReceipt` — auto-cascades
- `AiConversation`, `AiUsageRecord`, `AiFeedback`, `AiToolExecution`, `AiSafetyEvent`, `AiUserSetting` — auto-cascades
- `SubjectResourceView` — auto-cascades

### ANONYMISE required (Restrict FK):
- `StudentProfile` — anonymise personal fields, keep academic links
- `Message.senderId` — replace display name, preserve message structure
- `IssueComment.authorId` — anonymise author display
- `IssueAttachment.uploadedById` — preserve attachment, anonymise uploader
- `IssueOccurrence.reporterUserId` — anonymise reporter
- `FeedbackSubmission.studentUserId` — preserve aggregate data, anonymise identity
- `ReportedMessage.reportedById` — anonymise reporter

### PRESERVE required (Restrict FK):
- `SectionMembership` — historical academic record
- `AttendanceRecord` — legally required academic history
- `AttendanceSummary` — aggregate attendance data
- `AttendanceIntervention` — intervention history
- `Issue (reporterId)` — preserve issue integrity
- `IssueStatusHistory` — audit trail
- `IssueAffectedUser` — issue scope data
- `FileRecord` — handle individually (delete private, preserve shared)

---

## 7. Existing Soft-Delete Support

| Feature | Status |
|---------|--------|
| `AccountStatus.ARCHIVED` | ✅ Exists |
| `User.archivedAt` timestamp | ✅ Exists |
| Archive API endpoints | ✅ Exists |
| Restore API endpoints | ✅ Exists |
| Session revocation on archive | ✅ Exists |
| `ArchivedRecord` tracking model | ✅ Exists |
| `DataMaintenanceJob` model | ✅ Exists |
| `isTestData` flags on entities | ✅ Exists (Campus, Block, Floor, Room) |
| `isTestData` on User | ❌ Missing — needs migration |

---

## 8. Existing Backup System

| Feature | Status |
|---------|--------|
| `DatabaseBackup` model | ✅ Complete |
| `BackupManifest` model | ✅ Complete |
| `BackupRestoreTest` model | ✅ Complete |
| `PRE_DELETION` backup type | ✅ Exists in enum |
| AES-256-GCM encryption | ✅ Implemented |
| Google Drive upload | ✅ Implemented |
| Checksum verification | ✅ SHA-256 plain + encrypted |
| Schema version tracking | ✅ In manifest |
| Record count tracking | ✅ In manifest |

---

## 9. Required Migrations

1. Add `isTestData`, `testDataBatchId`, `testDataCreatedById` to `User` model
2. Add `DataDeletionRequest` model (full lifecycle tracking)
3. Add `DataDeletionAudit` model (deletion-specific audit trail)
4. Add indexes: `User(collegeId, archivedAt)`, `FileRecord(uploadedById)`, `FeedbackSubmission(studentUserId)`
5. Verify all existing indexes against query patterns

---

## 10. Security Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Unrestricted bulk delete | **Critical** | Require archive-first, max batch size, confirmation |
| Cross-college user deletion | **Critical** | Verify `collegeId` scope in every query |
| Frontend-trusted dependency data | **High** | Recalculate dependencies server-side in transaction |
| Plaintext confirmation phrase in logs | **Medium** | Hash confirmation phrase, never log |
| Orphaned FK references after deletion | **High** | Use single transaction, validate post-commit |
| Google Drive deletion inside DB transaction | **Medium** | Use outbox pattern, background worker |
| Missing backup blocks deletion | **Critical** | Verify backup status = COMPLETED before proceeding |
| Mass deletion of real data flagged as test | **High** | Explicit `isTestData` flags, not heuristics |

---

## 11. Files to Modify

### Backend (API):
| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `DataDeletionRequest`, `isTestData` fields, new indexes |
| `apps/api/src/modules/users/users.service.ts` | Implement `dependencyReport()`, `deletePermanently()`, `anonymiseProfile()` |
| `apps/api/src/modules/users/users.controller.ts` | Verify deletion endpoint routing, add dependency check |
| `apps/api/src/modules/users/dto/user.dto.ts` | Extend `DeleteUserDto` with `deletionMode`, `backupId` |
| `apps/api/src/modules/audit/audit.service.ts` | Add deletion-specific audit methods |
| `apps/api/src/modules/backups/backups.service.ts` | Add pre-deletion student export package |

### Frontend (Web):
| File | Change |
|------|--------|
| `apps/web/src/app/globals.css` | Add design system tokens, responsive components |
| `apps/web/src/components/app-shell.tsx` | Improve mobile navigation, add admin bottom nav |
| `apps/web/src/components/navigation.ts` | Reorganise navigation items |
| `apps/web/src/app/(portal)/admin/users/page.tsx` | Complete rewrite into components |
| `apps/web/src/app/(portal)/page.tsx` | Dashboard redesign |
| `apps/web/src/app/(portal)/profile/` | Profile page redesign |

### New frontend files:
| File | Purpose |
|------|---------|
| `apps/web/src/styles/tokens.css` | Design tokens |
| `apps/web/src/components/ui/` | Shared UI components directory |
| `apps/web/src/app/(portal)/admin/people/` | New People Management route |

---

## 12. Design System Audit

### Current CSS state:
- `globals.css` is 5,871 lines with TailwindCSS import
- CSS variables defined in `:root`: `--primary-blue`, `--secondary-blue`, `--page`, `--card`, `--success`, `--warning`, `--danger`, `--text`, `--muted`, `--border`, `--sidebar`, `--radius`, `--shadow`
- Font: Inter (already good)
- Many inline styles throughout components
- No systematic spacing/typography scale
- No responsive breakpoint variables
- No component-level CSS files

### Required design tokens:
- Complete colour palette with HSL values
- 8-point spacing scale
- Typography scale (heading sizes, weights)
- Border-radius scale
- Shadow elevation scale
- Breakpoints: 320px, 768px, 1024px, 1440px
- Animation durations
- Touch target minimum: 44px

---

## 13. Summary of Findings

### What already works well:
- ✅ Comprehensive Prisma schema (3,500+ lines)
- ✅ Permission-based access control
- ✅ Audit logging infrastructure
- ✅ Database backup with encryption and Google Drive
- ✅ Account status lifecycle (PENDING → ACTIVE → SUSPENDED/ARCHIVED)
- ✅ Archive/Restore API endpoints
- ✅ DeleteUserDto with confirmation phrase requirement
- ✅ PRE_DELETION backup type in enum
- ✅ DataMaintenanceJob model for controlled operations
- ✅ Inter font, CSS variables for theming

### What needs significant work:
- ❌ No `dependencyReport()` implementation
- ❌ No `deletePermanently()` implementation  
- ❌ No student data anonymisation logic
- ❌ No pre-deletion student export package
- ❌ No outbox pattern for Drive file deletion
- ❌ People page is one 71KB monolithic component
- ❌ No mobile card layout for people
- ❌ No responsive bottom-sheet filters
- ❌ No dependency dialog UI
- ❌ No permanent delete confirmation dialog
- ❌ Dashboard shows basic overview, not professional stat cards
- ❌ No design token system
- ❌ No shared UI component library
- ❌ No `isTestData` flag on User model
- ❌ No automated tests for deletion safety
