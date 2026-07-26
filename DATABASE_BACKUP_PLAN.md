# Database Backup Plan

Primary database: PostgreSQL  
Backup script: `scripts\backup.ps1`  
Restore script: `scripts\restore.ps1`  
Backup directory: `backups\`

## 2026-07-19 Status

- Verified source/config backup:
  `D:\AVS_BACKUPS\final-master-20260719-212416\project-source.tar.gz`.
- Fresh database dump was not created in this pass because local `pg_dump` is
  unavailable and Docker CLI calls timed out.
- Do not run `pnpm cleanup:data --confirm` until a fresh PostgreSQL dump exists
  and is verified.

Next safe backup command after Docker is responsive:

```powershell
.\scripts\backup.ps1 -UseDocker
```

## Latest Verified Backups

| Artifact          | Path                                            |
| ----------------- | ----------------------------------------------- |
| Database dump     | `backups\college-20260716-200538.dump`          |
| Database checksum | `backups\college-20260716-200538.dump.sha256`   |
| Project archive   | `backups\project-20260716-200333.tar.gz`        |
| Project checksum  | `backups\project-20260716-200333.tar.gz.sha256` |

## Create Backup

```powershell
.\scripts\backup.ps1
```

The script creates a PostgreSQL custom-format dump and SHA-256 checksum. It can use Docker fallback values for `POSTGRES_DB=college_management` and `POSTGRES_USER=college_app` when container environment inspection is unavailable.

## Verify Backup

```powershell
Get-FileHash -Algorithm SHA256 .\backups\college-YYYYMMDD-HHMMSS.dump
docker compose exec -T postgres pg_restore --list /path/to/backup.dump
```

For local files, copy the dump into a temporary container path or use host PostgreSQL tools if installed. Never verify by restoring over the active database.

## Restore Drill

```powershell
.\scripts\restore.ps1 -BackupFile .\backups\college-YYYYMMDD-HHMMSS.dump -ConfirmRestore
```

Restore only to an isolated rehearsal database unless the production incident plan explicitly approves an active restore. Stop application writers before restoring production.

## Schedule

- Local development: before migrations, cleanup, imports and major refactors.
- Production: daily encrypted database backup, weekly restore rehearsal, and before every migration.
- Object storage: snapshot MinIO/S3 separately; PostgreSQL backup does not contain private uploaded files.
