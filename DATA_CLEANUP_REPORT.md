# Data Cleanup Report

## 2026-07-19 Final Master Pass

No confirmed database cleanup was executed in this pass.

Reason: a new PostgreSQL dump could not be created because local `pg_dump` is
not installed and Docker CLI calls timed out. Confirmed cleanup remains blocked
until a fresh dump is created and verified.

Current cleanup entrypoint:

```powershell
pnpm cleanup:data --dry-run
pnpm cleanup:data --confirm --backup-file <verified-dump>
```

The entrypoint maps to `scripts/cleanup-unnecessary-data.ts`, which delegates to
the guarded transactional cleanup implementation and refuses confirmed deletion
without `--backup-file`.

Date: 16 July 2026  
Environment: local Docker Compose PostgreSQL  
Backup used: `backups\college-20260716-200538.dump`

## Safety Gates

Cleanup was performed only after:

1. A fresh project archive was created: `backups\project-20260716-200333.tar.gz`.
2. A fresh PostgreSQL custom dump was created: `backups\college-20260716-200538.dump`.
3. The project archive was listed with `tar -tzf`.
4. The database dump was listed with `pg_restore --list`.
5. The cleanup script confirmed the Main Admin account existed before deleting anything.

## Tooling

The cleanup tool is:

```powershell
npm run cleanup:data -- --dry-run
npm run cleanup:data -- --confirm --backup-file "D:\COLLEGE MANAGEMENT SITE\backups\college-20260716-200538.dump"
```

`scripts/cleanup-demo-data.ts`:

- defaults to dry-run mode;
- requires `--confirm` and `--backup-file` for deletion;
- preserves the configured Main Admin account;
- runs inside one PostgreSQL transaction;
- refuses cleanup if the Main Admin is missing;
- creates an audit entry with action `data_cleanup.demo_data`;
- rolls back automatically if any statement fails.

## Deleted Demo Signatures

The confirmed cleanup targeted seeded/demo identities:

`SUPER001`, `PRN001`, `VP001`, `HOD-CSE`, `FAC101`, `CC-CSE3A`, `STU26001`, `STU26002`, `MNT001`, `ELEC001`, `PLMB001`, `IT001`

It also targeted seeded sample issues, development announcements, demo attendance records, demo conversations/messages, and notifications tied to those identities. A separate safe transaction removed the duplicate non-admin Devanand student/test account while preserving audit history.

## Result

Latest dry-run result after cleanup:

| Target                       | Remaining |
| ---------------------------- | --------: |
| demo users                   |         0 |
| sample issues                |         0 |
| demo announcements           |         0 |
| demo conversations           |         0 |
| demo messages                |         0 |
| demo attendance sessions     |         0 |
| demo attendance records      |         0 |
| demo notification recipients |         0 |
| demo delivery attempts       |         0 |

Current database state:

| Table              | Count |
| ------------------ | ----: |
| users              |     1 |
| issues             |     0 |
| attendance_records |     0 |
| announcements      |     0 |
| roles              |    18 |
| departments        |     3 |
| sections           |     2 |
| rooms              |    18 |

Main Admin preserved:

The configured Main Admin was `ACTIVE` with `must_change_password=false`; its identity is intentionally omitted.

API and browser login were both verified after cleanup. The returned user is Devanand with role `MAIN_ADMIN` and `mustChangePassword=false`.

## Retained Data

Required roles, permissions, migrations, audit infrastructure and campus/academic master data were retained. Official department/class/maintenance conversations remain because they are system channels, not fake user records.
