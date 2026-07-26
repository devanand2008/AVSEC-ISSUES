# Backup and Restore

Latest verified local source backup date: 19 July 2026.

Latest database backup attempt on 19 July 2026 was blocked because local
`pg_dump` is unavailable and Docker CLI calls timed out. Confirmed data cleanup
must not be run until a fresh PostgreSQL dump is created and verified.

## Latest Artifacts

| Artifact | Path |
| --- | --- |
| Project source archive | `D:\AVS_BACKUPS\final-master-20260719-212416\project-source.tar.gz` |
| Project source checksum | `D:\AVS_BACKUPS\final-master-20260719-212416\project-source.tar.gz.sha256` |
| Environment snapshot | `D:\AVS_BACKUPS\final-master-20260719-212416\env.snapshot` |
| Migration history | `D:\AVS_BACKUPS\final-master-20260719-212416\migration-history.txt` |
| PostgreSQL dump | `backups\college-20260716-200538.dump` |
| PostgreSQL checksum | `backups\college-20260716-200538.dump.sha256` |
| Project archive | `backups\project-20260716-200333.tar.gz` |
| Project checksum | `backups\project-20260716-200333.tar.gz.sha256` |

## Create Database Backup

```powershell
.\scripts\backup.ps1
```

The script creates a PostgreSQL custom-format dump and a SHA-256 checksum under `backups\`. It can use the running Docker PostgreSQL container when local `pg_dump` tools are unavailable.

## Create Project Archive

```powershell
tar --exclude=node_modules --exclude=.git --exclude=backups -czf .\backups\project-YYYYMMDD-HHMMSS.tar.gz .
Get-FileHash -Algorithm SHA256 .\backups\project-YYYYMMDD-HHMMSS.tar.gz
```

## Verify

```powershell
Get-FileHash -Algorithm SHA256 .\backups\college-YYYYMMDD-HHMMSS.dump
pg_restore --list .\backups\college-YYYYMMDD-HHMMSS.dump
tar -tzf .\backups\project-YYYYMMDD-HHMMSS.tar.gz
```

When host PostgreSQL tools are unavailable, use `docker compose exec -T postgres pg_restore --list` after copying the dump into an isolated verification path.

## Restore

Restoration is destructive and requires explicit confirmation:

```powershell
.\scripts\restore.ps1 -BackupFile .\backups\college-YYYYMMDD-HHMMSS.dump -ConfirmRestore
```

Never test restore against the active database. Rehearse restore into an isolated database, compare row counts, verify audit history, then reopen application traffic.

## Notes

PostgreSQL is authoritative. Redis is queue/cache state and MinIO/S3 stores uploaded private files, so object storage snapshots are required for full disaster recovery.
