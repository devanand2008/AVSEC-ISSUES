# Google Cloud deployment audit

Audit date: 5 August 2026

Repository: `https://github.com/devanand2008/AVSEC-ISSUES`

Audited commit: `00210910af38c66d298095b86c85d166169ecf51` (`main`, synchronized with `origin/main`)

## Deployment gate status

Repository audit and the complete local quality gate pass. Google Cloud provisioning is blocked by the required approval/authentication gate: the Google Cloud CLI is not installed on this workstation, so no authenticated account, selected project, project number, billing state, or configured Google Cloud region can currently be verified. No Google Cloud resource has been created or changed.

Unrelated untracked directories in the workspace were not inspected as application source and were not modified: `learn language/`, `legacy/`, `logo/`, `mkcert-master/`, and `worker management system2/`.

## Actual repository architecture

| Item | Audited implementation |
| --- | --- |
| Monorepo | npm workspaces declared in root `package.json` |
| Frontend | `apps/web`, Next.js 16.2.12 App Router with React 19 |
| Backend | `apps/api`, NestJS 11.1.28 |
| Shared packages | `packages/shared-types` and `packages/validation` |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Prisma configuration | `apps/api/prisma.config.ts` |
| Prisma migrations | `apps/api/prisma/migrations`; 39 ordered migrations |
| Generated Prisma client | `apps/api/src/generated/prisma` |
| Backend compiled entry | `apps/api/dist/main.js` |
| Frontend build output | `apps/web/.next/standalone`, `apps/web/.next/static`, and `apps/web/public` |
| PWA manifest | `apps/web/public/manifest.webmanifest` |
| Service worker | `apps/web/public/sw.js` |
| WebSocket implementation | Socket.IO namespace `/realtime`, authenticated with the application session |
| Current object storage | S3-compatible client configured by `S3_*`; local runtime uses MinIO |
| Current background jobs | BullMQ queues backed by `REDIS_URL` |
| Current production images | Separate `apps/api/Dockerfile` and `apps/web/Dockerfile` |
| Root production Dockerfile | Missing |
| Cloud Build configuration | Missing (`cloudbuild.yaml` does not exist) |

## Build and test evidence

`npm run check` completed successfully on 5 August 2026 in 953.7 seconds.

- Prisma schema validation: passed.
- Type checks: passed for API, web, shared types, and validation.
- Lint: passed for all workspaces with zero warnings.
- API tests: 51 suites and 408 tests passed.
- Web tests: 12 files and 65 tests passed.
- NestJS production build: passed and emitted `apps/api/dist/main.js`.
- Next.js production build: passed; 83 routes were generated.
- The Next build contains both prerendered and dynamic server-rendered routes. Dynamic routes include feedback tokens, certificate verification, issue details, people details, attendance details, and staff-rating details.
- Non-failing warning: Jest reported an asynchronous open handle after all API tests completed. This must be isolated before the Cloud Build gate is considered clean, even though the command exited successfully.

The existing Docker Compose runtime is also healthy: PostgreSQL, Redis, MinIO, API, and web containers are running. `http://127.0.0.1:3000` and `http://127.0.0.1:4000/api/v1/health/live` return HTTP 200. `http://127.0.0.1:4000/health` returns HTTP 404, confirming the public health route required for Cloud Run is not implemented at the root origin yet.

## Reported AVS workflow status

The 15 reported workflow fixes are present in commit `0021091` and are documented with affected code, migrations, tests, and manual verification instructions in `docs/reported-issues-fixing-report.md`. The current full quality gate passes after those fixes.

Confirmed by source and automated coverage:

- floor, room/area, specific asset, and Continue-button issue flow;
- half-day and class-session attendance;
- AVS Bot backend routes and persistence layer;
- configurable lesson assessments;
- AVS Skill compiler provider mapping and audit records;
- branded certificate generation and public verification;
- scoped AVS Learn subjects;
- attendance-correction access controls;
- directly/team-assigned maintenance issues;
- authenticated Messenger rooms and reconnect behavior;
- broadcast recipient lookup and persistence.

Still requires deployed-environment verification: real OpenAI calls, approved compiler-provider behavior, two-user WebSocket messaging, broadcast delivery, Firebase/email/WhatsApp providers, phone QR scanning, Cloud Storage uploads, database backup/restore, and the full mobile viewport matrix.

## Current deployment problems

1. **Google Cloud authentication is unavailable.** `gcloud` is neither on `PATH` nor present in standard Windows installation locations. The primary account stated in the deployment request, `devanand.s2008@gmail.com`, has not been independently authenticated.
2. **There is no verified Google Cloud project or billing status.** Project ID, project number, billing account, and active region are unknown. Provisioning paid resources is prohibited until they are displayed and approved.
3. **The requested frontend cannot be copied as static files only.** The Next.js build uses `output: "standalone"` and includes dynamic SSR routes. Converting it to a static export would break unknown-token/ID deep links unless the application were substantially redesigned.
4. **No single-service production container exists.** The current API and frontend images are separate.
5. **Required public health routing differs from the implementation.** Nest applies the global `api/v1` prefix, so health is currently `/api/v1/health`, `/api/v1/health/live`, and `/api/v1/health/ready/dependencies`; `/health`, `/health/live`, and `/health/ready` are not available at the public root. The existing `/api/v1/health/ready` also requires the `system.health` permission.
6. **Redis is a real runtime dependency.** BullMQ powers delivery, imports, announcements, and backups; Socket.IO uses the Redis adapter; readiness currently fails if Redis is absent. A production Redis design must therefore be approved or these systems must be rewritten for Cloud Tasks/database-backed work.
7. **Object storage is S3/MinIO-specific.** Multiple modules instantiate the AWS S3 client, require static access/secret keys, and construct a MinIO host/port URL. Native private GCS, Application Default Credentials, IAM signing, and authorized `/files/:id` behavior are not implemented.
8. **There is no generic `/files/:id` route.** Existing authorized file access is spread across issue, profile, message, import, learning-resource, and announcement endpoints.
9. **Production migrations run during API container startup.** The current API image executes `prisma migrate deploy` and a production bootstrap before starting Nest. That is unsafe under Cloud Run concurrency and must be moved to a controlled migration job/build step.
10. **Backups are not GCS/Cloud Run Job based.** The encrypted `pg_dump` workflow currently targets local storage and optional Google Drive, with Redis-backed scheduling. GCS primary backup storage, a Cloud Run backup job, Scheduler invocation, and an isolated restore-test job are absent.
11. **The compiler uses public Judge0 and Piston endpoints.** Code is not executed in the NestJS container, which is good, but provider allowlisting, contractual isolation guarantees, egress policy, and an explicit production enable/disable configuration are not yet sufficient for the requested production safety gate.
12. **Same-origin frontend configuration is not the production default.** The web client defaults to `http://localhost:4000/api/v1` and `http://localhost:4000/realtime`; production must compile `/api/v1` and `/realtime` or otherwise resolve them to the deployed origin.
13. **Cloud deployment automation is absent.** Root Dockerfile, Cloud Build pipeline, migration/backup/restore jobs, post-deployment smoke scripts, IAM manifests, and Google Cloud operational documentation must be added.

## Required environment changes

Existing required production secrets include `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`, S3 credentials, and optional provider secrets. Google Cloud deployment requires these changes:

- use `PORT=8080` only for the public in-container proxy and separate internal ports for Next and Nest;
- use the same public HTTPS origin for `WEB_URL`, allowed origins, cookies, QR links, certificate links, API, and WebSockets;
- replace `S3_*`/MinIO public endpoint assumptions with `GCP_PROJECT_ID`, `GCS_FILES_BUCKET`, `GCS_BACKUPS_BUCKET`, and `GCS_EXPORTS_BUCKET` plus workload identity/Application Default Credentials;
- add an explicit storage-provider selection during the transition;
- add deployment version/commit metadata for health responses;
- make the compiler disabled by default unless an approved isolated provider is configured;
- keep optional Google Drive support disabled until separate OAuth consent is granted;
- supply Redis private connectivity if the current BullMQ/Socket.IO design is retained;
- keep all secret values in Secret Manager and never in build arguments or `NEXT_PUBLIC_*` variables.

## Required architecture changes before deployment

The technically correct one-public-URL design is one Cloud Run service and one container image containing:

1. an unprivileged reverse proxy listening on Cloud Run `PORT=8080`;
2. NestJS on an internal-only port (for `/api/v1/*`, `/health*`, authorized file routes, and Socket.IO upgrades);
3. the Next.js standalone server on an internal-only port for all frontend and deep-link routes.

The proxy must route `/api/v1/*`, `/health*`, `/files/*`, `/realtime/*`, and Socket.IO upgrade traffic to Nest and everything else to Next. This preserves a single public origin while retaining the existing dynamic Next.js routes. It is a deliberate adaptation of the prompt's static-file concept to the actual build output.

Further required work:

- implement public non-secret-bearing health aliases with separate liveness and dependency readiness semantics;
- add a native GCS storage adapter and preserve authorization before downloads or short-lived signed URLs;
- move Prisma migration/bootstrap into a controlled Cloud Run Job or Cloud Build invocation;
- add a dedicated GCS backup job and isolated restore-test job;
- retain Redis with an approved managed private service, or replace all BullMQ/Redis responsibilities before deployment;
- add the secure root multi-stage Dockerfile and `.dockerignore` validation;
- add a fail-fast `cloudbuild.yaml` with tests, image digest/tagging, migration, deploy, health, and smoke stages;
- add deployed-origin QR regeneration and browser/mobile/WebSocket test automation.

## Migration safety

The 39 migrations validate and have previously been applied from zero to a disposable PostgreSQL database. The two latest reported-issue migrations are additive. Production rollout still requires a verified pre-migration backup and must use only `prisma migrate deploy`; reset, force-reset, destructive push, and direct production truncation are prohibited.

## Audit conclusion

The repository is locally buildable and testable, but it is not yet Google Cloud deployable under the requested architecture. The immediate blockers are Google Cloud CLI/authentication, verified project and billing selection, explicit approval of the cost-bearing resource plan, and implementation of the architecture changes above. Production readiness cannot be claimed until the real Cloud Run URL and every required infrastructure-dependent test pass.
