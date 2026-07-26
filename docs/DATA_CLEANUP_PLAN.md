# Data Cleanup Plan

Canonical cleanup docs: `../DATA_CLEANUP_REPORT.md` and
`../DATABASE_CLEANUP_PLAN.md`.

Cleanup entrypoint:

```powershell
pnpm cleanup:data --dry-run
pnpm cleanup:data --confirm --backup-file <verified-dump>
```

The script preserves Devanand Main Admin and refuses confirmed deletion without a
verified backup file.
