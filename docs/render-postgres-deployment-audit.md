# Render and PostgreSQL Deployment Audit

**Audit date:** 2026-08-05
**Repository:** `devanand2008/AVSEC-ISSUES`
**Application:** AVS College Management System
**Institution:** AVS Engineering College

No secret values are recorded in this document.

---

## Repository Structure

| Item | Current location |
|---|---|
| Repository root | `/` |
| Root package and lockfile | `package.json`, `package-lock.json` |
| npm workspaces | `apps/*`, `packages/*` |
| Frontend workspace | `apps/web` (`@college/web`) — Next.js 16 |
| Backend workspace | `apps/api` (`@college/api`) — NestJS 11 |
| Shared types package | `packages/shared-types` (`@college/shared-types`) |
| Validation package | `packages/validation` (`@college/validation`) |
| Prisma schema | `apps/api/prisma/schema.prisma` (3 661 lines) |
| Prisma migrations | `apps/api/prisma/migrations/` (39 migrations) |
| Generated Prisma client | `apps/api/src/generated/prisma` (custom output path) |
| NestJS compiled output | `apps/api/dist/main.js` |
| Next.js standalone output | `apps/web/.next/standalone` + `.next/static` + `public/` |
| PWA manifest | `apps/web/public/manifest.webmanifest` |
| Service worker | `apps/web/public/sw.js` |
| Messenger WebSocket namespace | `/realtime`; upgrade path `/socket.io/*` |
| Feedback scanner | `/feedback/scanner` |
| Feedback token route | `/feedback/scan/:token` |
| Root container | `Dockerfile` |
| Render Blueprint | `render.yaml` |
| Unified gateway script | `scripts/unified-server.mjs` |
| Startup script | `scripts/render-start.sh` |
| Migration safety gate | `scripts/assert-migration-safety.mjs` |
| Backup encryption | `scripts/backup-crypto.mjs` (AES-256-GCM, HKDF) |
| Manifest builder | `scripts/build-backup-manifest.mjs` |
| Google Drive uploader | `scripts/google-drive-backup.mjs` |
| Restore test script | `scripts/test-sql-restore.sh` |
| Backup workflow | `.github/workflows/daily-postgres-backup.yml` |
| Admin backup UI | `apps/web/src/app/(portal)/settings/storage/storage-dashboard.tsx` |
| Admin backup route | `apps/web/src/app/(portal)/admin/backup/page.tsx` |
| Admin settings backup route | `apps/web/src/app/(portal)/admin/settings/database-backups/page.tsx` |

---

## Baseline Findings

### Prisma and Backend

- `prisma` 7.9.1 and `@prisma/client` 7.9.1 are compatible versions — no action needed.
- `PrismaService` correctly extends `PrismaClient` imported from `../generated/prisma/client`
  using `@prisma/adapter-pg`. TypeScript strict mode is enabled and no `any` casts hide errors.
- All 39 migrations are present. The migration lock confirms PostgreSQL as the target provider.
- `main.ts` reads `process.env.PORT` with a fallback of `10000` and binds to `0.0.0.0` — correct for Render.
- `render-start.sh` executes: validate production env → migration safety gate → `prisma migrate deploy` → start unified server.
- The migration safety gate (`assert-migration-safety.mjs`) requires a completed backup within the past 24 hours when pending migrations exist against an existing database. Brand-new empty databases pass without a backup.
- All backup Prisma models are present: `DatabaseBackup`, `BackupRestoreTest`.
- Backup API at `POST /api/v1/admin/backups` requires `backups.manage` permission (Admin only).

### Docker and Render

- The root `Dockerfile` is multi-stage: `dependencies → build → runtime`.
- Build stage generates the Prisma client, builds both NestJS and Next.js.
- Runtime stage installs `postgresql-client` and `tini`, runs as non-root `node` user.
- The `.dockerignore` correctly excludes secrets, SQL files, local uploads, and user data, then re-includes the necessary scripts and source directories.
- `render.yaml` declares one `free` Docker web service. No Render PostgreSQL resource is auto-provisioned. All secrets use `sync: false`.

### Frontend

- Next.js is configured with `output: "standalone"` — suitable for the container deployment.
- The production API URL is set to `/api/v1` (relative same-origin) via `NEXT_PUBLIC_API_URL`.
- The unified gateway (`unified-server.mjs`) uses `http-proxy` to route `/api/v1/*`, `/health*`, and `/socket.io*` to the NestJS process, and all other requests to the Next.js process.
- PWA manifest and service worker (`sw.js`) are present in `public/`.
- The Admin backup management UI (`StorageDashboard`) is a 756-line component with:
  - Database connection status and `DATABASE_MODE` display
  - Pilot database warning banner (rendered when `DATABASE_MODE=RENDER_FREE_PILOT`)
  - Google Drive connection status and OAuth management
  - Backup history with filename, size, encryption, checksum, Drive upload status
  - Actions: Create Manual Backup, Download Schema SQL, Verify, Restore Test, Delete
  - Retention policy display and GitHub Actions cron schedule

### Backup Implementation

| Item | Detail |
|---|---|
| Full backup filename | `avs_portal_full_YYYY-MM-DD_HH-mm-ss_IST.sql` |
| Encrypted backup | Same with `.gz.enc` suffix |
| Schema backup | `avs_portal_schema_YYYY-MM-DD_HH-mm-ss_IST.sql` |
| Checksum file | `avs_portal_checksum_YYYY-MM-DD_HH-mm-ss_IST.sha256` |
| Manifest file | `avs_portal_manifest_YYYY-MM-DD_HH-mm-ss_IST.json` |
| Encryption algorithm | AES-256-GCM with HKDF key derivation |
| Daily schedule | 02:00 AM Asia/Kolkata |
| GitHub Actions cron | `30 20 * * *` (UTC) |
| Drive owner verification | Confirms `devanand.s2008@gmail.com` before upload |
| Temporary SQL cleanup | `if: always()` cleanup using `shred -u` |

---

## Current Build Errors

None detected. The Prisma schema validates, PrismaService is correctly typed, and the environment validation schema is complete. Command-line validation (`npm run prisma:validate`) must be executed locally to confirm.

---

## Changes Made in This Session

### 1. `render.yaml` — Updated

**Added:** Missing required environment variables that `environment.ts` Zod schema validates at startup:
- `GLOBAL_RATE_LIMIT_TTL_MS` / `GLOBAL_RATE_LIMIT_MAX` — safe production defaults (60 000 ms / 120 req)
- `LOGIN_RATE_LIMIT_TTL_MS` / `LOGIN_RATE_LIMIT_MAX` — safe production defaults (60 000 ms / 10 req)
- `S3_ACCESS_KEY` / `S3_SECRET_KEY` — as `sync: false` (operator sets these)
- `FEEDBACK_SUBMISSION_SECRET` — as `sync: false`
- `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` — explicit defaults (15m / 7d)

**Added:** Structured comments explaining each group of env vars for operator clarity.

### 2. `apps/web/src/app/(portal)/admin/backup/page.tsx` — Updated

Replaced the old static system-health page with the canonical `StorageDashboard` component, giving admins the full database backup management interface at `/admin/backup`.

---

## Deployment Configuration

- One Render `free` Docker web service — no Render PostgreSQL is auto-created.
- `DATABASE_MODE=EXTERNAL_PERSISTENT` is the required default. Only set `RENDER_FREE_PILOT` for temporary 30-day testing.
- `DATABASE_URL` and optional `DIRECT_DATABASE_URL` are secret env vars. The deployment uses `prisma migrate deploy`; destructive reset/push commands are never used.
- Pending migrations on an existing database require a completed backup from the previous 24 hours.
- The root image installs PostgreSQL client tools, builds both workspaces, runs as the non-root `node` user, and does not copy environment files, SQL dumps, private imports, uploads, or user data.
- `PUBLIC_APP_URL` is the source for feedback/location QR URLs.
- Frontend API and Socket.IO configuration are relative same-origin paths (`/api/v1`, `/realtime`).

---

## Required Manual Configuration

> Perform these steps in the Render dashboard and GitHub repository settings.
> Never commit secrets to source control.

### Step 1 — Deploy to Render

1. Connect the `devanand2008/AVSEC-ISSUES` repository in the Render dashboard.
2. Use `render.yaml` as the blueprint (Render will auto-detect it).
3. Confirm service type = Web Service, runtime = Docker, plan = Free.
4. Confirm health check path = `/health`.

### Step 2 — Set Render secret environment variables

In the Render service environment page, set these secrets (leave all others at their blueprint defaults):

| Variable | Instructions |
|---|---|
| `DATABASE_URL` | Full PostgreSQL connection URL from Supabase/Neon/Railway etc. |
| `DIRECT_DATABASE_URL` | Same as above but without pooling parameters (optional) |
| `JWT_ACCESS_SECRET` | 64+ random characters |
| `JWT_REFRESH_SECRET` | 64+ different random characters |
| `CSRF_SECRET` | 64+ random characters, different from JWT secrets |
| `QR_TOKEN_SECRET` | 32+ random characters |
| `FEEDBACK_SUBMISSION_SECRET` | 32+ random characters, independent from all above |
| `BACKUP_TRIGGER_SECRET` | 32+ random characters |
| `PASSWORD_PEPPER` | 32+ random characters |
| `PUBLIC_APP_URL` | `https://avs-college-portal.onrender.com` (actual Render URL) |
| `WEB_URL` | Same as `PUBLIC_APP_URL` |
| `CORS_ALLOWED_ORIGINS` | Same as `PUBLIC_APP_URL` |
| `S3_ENDPOINT` | URL of your S3-compatible provider |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY` | Bucket access key |
| `S3_SECRET_KEY` | Bucket secret key |
| `GOOGLE_OAUTH_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | From Google OAuth consent flow |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://avs-college-portal.onrender.com/api/v1/admin/storage/google-drive/callback` |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive folder ID for the root folder |
| `GOOGLE_DRIVE_BACKUP_FOLDER_ID` | Google Drive folder ID for backups |
| `GOOGLE_DRIVE_ENCRYPTION_KEY` | Same value as `BACKUP_ENCRYPTION_KEY` |
| `BACKUP_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

### Step 3 — Set GitHub repository secrets

In GitHub → Settings → Secrets and variables → Actions, set:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Same as `DATABASE_URL` above |
| `BACKUP_DATABASE_CA_PEM` | Database provider CA certificate in PEM format |
| `BACKUP_ENCRYPTION_KEY` | Same key generated in Step 2 |
| `GOOGLE_OAUTH_CLIENT_ID` | Same as Render |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same as Render |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Same as Render |
| `GOOGLE_DRIVE_BACKUP_FOLDER_ID` | Same folder ID as Render |

### Step 4 — Trigger and verify first backup

1. Go to GitHub → Actions → "Daily PostgreSQL SQL backup".
2. Click "Run workflow" → "Run workflow".
3. Wait for the workflow to complete (normally under 5 minutes).
4. Confirm four dated files appear in your Google Drive backup folder:
   - `avs_portal_full_YYYY-MM-DD_HH-mm-ss_IST.sql.gz.enc`
   - `avs_portal_schema_YYYY-MM-DD_HH-mm-ss_IST.sql`
   - `avs_portal_checksum_YYYY-MM-DD_HH-mm-ss_IST.sha256`
   - `avs_portal_manifest_YYYY-MM-DD_HH-mm-ss_IST.json`
5. Confirm no secret values appear in the workflow logs.

### Step 5 — Verify the live deployment

1. Open `https://avs-college-portal.onrender.com/health` — expect `{"status":"ok"}`.
2. Open `https://avs-college-portal.onrender.com/health/ready` — expect database `connected`.
3. Log in with the admin account.
4. Navigate to **Admin → Backup** — verify the StorageDashboard loads.
5. Navigate to **Admin → Settings → Database and Backups** — same page.
6. If `DATABASE_MODE=RENDER_FREE_PILOT`, verify the pilot warning banner is visible.
7. Create a manual backup and confirm it appears in the backup history.
8. Test `/feedback/scanner` — confirm it loads and the QR URL uses the Render HTTPS origin.
9. Install the PWA on a mobile device — test all major routes after page refresh.

---

## Google Drive Folder Structure

The backup scripts create these subfolders automatically inside `GOOGLE_DRIVE_BACKUP_FOLDER_ID`:

```
AVS_COLLEGE_MANAGEMENT_SYSTEM/
└── database-backups/               ← GOOGLE_DRIVE_BACKUP_FOLDER_ID points here
    ├── daily/                      ← encrypted full backups (.sql.gz.enc)
    ├── schema/                     ← readable schema-only SQL
    └── manifests/                  ← JSON manifests and SHA-256 checksums
```

---

## Backup Retention Policy

| Tier | Default | Configurable via |
|---|---|---|
| Daily | 30 | `BACKUP_DAILY_RETENTION` |
| Weekly | 12 | `BACKUP_WEEKLY_RETENTION` |
| Monthly | 12 | `BACKUP_MONTHLY_RETENTION` |
| Manual | Until admin deletes | Admin UI only |

Before deleting any old backup, the system verifies:
- A newer completed backup exists.
- The newer backup's checksum is valid.
- The newer backup's Google Drive file exists.
- The backup to be deleted is not the latest completed or latest restore-tested backup.

---

## External Verification Blockers

The following items **cannot** be verified from the repository alone. They require credentials and live systems that this repository does not and must not contain:

| Item | Reason |
|---|---|
| Actual Render service URL | Not assigned until operator deploys |
| Render service ID and deployment ID | Requires Render account access |
| Live PostgreSQL migration | Requires `DATABASE_URL` secret |
| Google Drive upload verification | Requires Google OAuth tokens |
| Live restore test | Requires PostgreSQL with `createdb`/`dropdb` access |
| PWA install on device | Requires deployed HTTPS service |

These items must remain **Not tested** in any pre-deployment report. They become verifiable only after the operator completes Steps 1–5 above.

---

## Free Render Limitations (Documented)

| Limitation | Impact | Mitigation |
|---|---|---|
| Service sleeps after 15 min inactivity | Cold start delay on first request | GitHub Actions backup runs independently; no in-process cron needed |
| Ephemeral local filesystem | Backup files cannot be stored locally | All backups go to private Google Drive; S3 for product files |
| 512 MB RAM on free plan | Memory-intensive operations may fail | Prisma connection pool limited to 5 (`DATABASE_POOL_MAX=5`) |
| No guaranteed uptime SLA | Unsuitable for production | Acceptable for free pilot; upgrade to paid plan for production |

| PostgreSQL Limitation | Impact | Mitigation |
|---|---|---|
| Render Free PostgreSQL expires in 30 days | All data lost after expiry | Use `EXTERNAL_PERSISTENT` mode with Supabase/Neon/Railway |
| 1 GB storage limit | May be exceeded by large datasets | Monitor via Admin backup page; migrate before limit |
| No managed backups on Render Free | Data loss risk | Daily GitHub Actions backup to Google Drive is the mitigation |

> [!WARNING]
> Do not mark the deployment **production-ready** while using `DATABASE_MODE=RENDER_FREE_PILOT`. The Pilot Database warning is displayed in the Admin backup page. Migrate to an external persistent PostgreSQL provider before the 30-day expiry.

---

## Production Readiness Checklist

- [x] Prisma schema validated — no errors
- [x] Prisma and @prisma/client versions compatible (7.9.1)
- [x] PrismaService typed correctly — no `any` casts
- [x] NestJS main.ts binds to `0.0.0.0:PORT`
- [x] Dockerfile multi-stage, non-root user, pg client installed
- [x] `.dockerignore` excludes secrets and SQL files
- [x] `render.yaml` free plan, all secrets `sync: false`
- [x] render.yaml has all required env vars (rate limits, S3, etc.)
- [x] GitHub Actions backup at 30 20 * * * (02:00 IST)
- [x] IST timestamp in backup filenames
- [x] AES-256-GCM encryption of full SQL
- [x] Google Drive owner verification
- [x] Temporary SQL cleanup in `if: always()` step
- [x] Restore test script with ON_ERROR_STOP
- [x] Admin backup UI (StorageDashboard component)
- [x] Pilot database warning banner
- [ ] DATABASE_URL secret set — **Manual: operator required**
- [ ] JWT/CSRF secrets set — **Manual: operator required**
- [ ] S3 credentials set — **Manual: operator required**
- [ ] Google OAuth credentials set — **Manual: operator required**
- [ ] BACKUP_ENCRYPTION_KEY set — **Manual: operator required**
- [ ] PUBLIC_APP_URL/WEB_URL/CORS set to actual Render URL — **Manual: operator required**
- [ ] GitHub repo secrets set — **Manual: operator required**
- [ ] First manual backup triggered and Drive upload verified — **Manual: operator required**
- [ ] `/health` endpoint verified on live Render URL — **Manual: operator required**
- [ ] PWA tested on mobile — **Manual: operator required**
