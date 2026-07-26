# User Import Guide

## Where To Import

Open `Admin Panel -> Bulk imports`.

Use:

- `Combined users` for mixed student, staff, admin, and maintenance rows.
- `Students` for student-only account creation or updates.
- `Staff and admins` for Principal, Vice Principal, HOD, Class Coordinator, Faculty, Maintenance Staff, and other service roles.

Supported files:

- `.csv`
- `.xlsx`

Legacy `.xls` workbooks must be saved as `.xlsx` before upload.

## Import Modes

For user imports, choose one mode before preview:

- `Create only`: rejects rows whose stable ID already exists.
- `Create and update`: creates missing users and updates users that already match by stable ID.
- `Update only`: rejects rows that do not match an existing stable ID.

Stable ID matching uses `student_id`, `employee_id`, or `college_identity_id` depending on the row.

## Flow

1. Select the import type and import mode.
2. Upload or drag in the spreadsheet.
3. If the workbook has multiple sheets, choose the sheet and revalidate.
4. Review the preview, row errors, detected columns, and suggested column mapping.
5. Correct any mapping values and apply mapping when the source headers are non-standard.
6. Choose `Do not import` for extra source columns that should be skipped.
7. Confirm only after the valid/error counts look correct.
8. Download the result or credential export when available.

The selected sheet, import mode, and column mapping are saved on the import job. The queued import reuses those exact settings so processing cannot drift from the preview.

## Validation

Preview performs file and database validation before a job is confirmed. It checks:

- Required fields, duplicate rows, formula cells, and text values that begin with spreadsheet formula characters.
- Missing or unexpected headers, while still showing raw columns for mapping.
- Role existence and active role status.
- Department, programme, section, semester, and subject references.
- Duplicate login IDs and email conflicts.
- One active Principal per college and one active HOD per department.
- Class Coordinator, Class Representative, and Faculty assignment conflicts.

## Password Handling

Temporary passwords are accepted from the import file, validated, hashed with Argon2id, and stored only as hashes. Imported users are marked as requiring a first-login password change.

Credential exports are one-time downloads. Treat spreadsheets containing temporary passwords as sensitive and delete local copies after distribution.

## Rollback

Newly created records remain rollbackable from the import job. Update rows are recorded as `UserUpdate` audit records and are intentionally excluded from rollback because the prior state can include password and profile data that should not be reconstructed casually.
