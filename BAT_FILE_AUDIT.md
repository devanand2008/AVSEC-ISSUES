# BAT File Audit

Audit date: 2026-07-19

## Files Found Before Consolidation

| File | Purpose | Consolidation result |
| --- | --- | --- |
| `quick-start.bat` | Development quick start, Docker infra, migrations, seed, native `npm run dev`. Printed default password. | Merged prerequisite checks, infra startup, Prisma generation/migration and app startup into `START_AVS_APP.bat`; password printing removed. |
| `run-docker.bat` | Full Docker build/start, seed and log follow. Printed default password and detached containers. | Merged Docker Compose startup and health checks into `START_AVS_APP.bat`; seed is no longer run on every startup. |
| `start-avs-college-system.bat` | LAN-focused Docker startup with LAN IP and mobile QR output. | Merged LAN IP detection, `0.0.0.0` binding, mobile URL, API URL and QR display into `START_AVS_APP.bat`. |
| `start-project.bat` | Native dev startup with Docker infra and dependency checks. | Merged Node/npm checks, dependency install-if-missing, Prisma generation and migration. |
| `start-production.bat` | Production verification/build/deploy pipeline. | Production safety guidance is retained in docs; universal launcher remains a local/LAN startup entrypoint and does not reset data. |
| `worker management system2\nodejs\nodevars.bat` | Legacy Node distribution helper outside the maintained app. | Removed as obsolete project baggage. |
| `worker management system2\nodejs\install_tools.bat` | Legacy Node distribution helper outside the maintained app. | Removed as obsolete project baggage. |

## Final State

The repository now contains exactly one BAT file:

```text
START_AVS_APP.bat
```

Verified:

```powershell
cmd.exe /c START_AVS_APP.bat --check
```

Result: prerequisite and configuration checks passed without starting services.

## Universal Launcher Behavior

- Sets the project root automatically.
- Checks Node.js, npm, Docker and Docker Compose.
- Creates `.env` from `.env.example` only when missing.
- Detects the active LAN IPv4 address without hardcoding.
- Sets web/API bind addresses and browser-facing API URLs for LAN use.
- Creates `logs/startup.log`, `logs/frontend.log` and `logs/backend.log` paths.
- Installs dependencies only when `node_modules` is missing.
- Generates Prisma client.
- Starts PostgreSQL, Redis and MinIO through Docker Compose.
- Applies safe pending Prisma migrations.
- Starts API and web containers.
- Waits for API and web health checks.
- Opens the browser unless `--no-open` is supplied.
- Displays desktop, mobile, API and PWA install guidance.
- Offers to stop confirmed stale Node/shell dev processes on app ports.
- Stops API/web containers on user request without deleting database data.

## Safety Notes

- The launcher never runs destructive database reset commands.
- The launcher does not seed on every startup.
- Database, Redis and MinIO host ports remain controlled by `docker-compose.yml`.
- Phone camera access still requires HTTPS; see `CAMERA_HTTPS_SETUP.md`.
