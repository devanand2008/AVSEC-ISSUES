# Database Backup Plan

Canonical plan: `../DATABASE_BACKUP_PLAN.md`.

Run after Docker is responsive:

```powershell
.\scripts\backup.ps1 -UseDocker
```

Confirmed cleanup must not run until a fresh dump and checksum are verified.
