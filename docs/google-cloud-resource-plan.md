# Google Cloud resource plan

Plan date: 5 August 2026

Application: AVS College Management System

Default region: `asia-south1`

Application timezone: `Asia/Kolkata`

## Approval gate

No Google Cloud resources may be created from this plan until the authenticated account, selected project, project number, billing state, and region have been verified and displayed, and the cost-bearing resources below have been explicitly approved.

| Required identity/project field | Current verified value |
| --- | --- |
| Google account | Unavailable; Google Cloud CLI is not installed |
| Authenticated identities | None verifiable |
| Project ID | Not selected |
| Project number | Unknown |
| Billing status | Unknown |
| Region | Proposed `asia-south1`; not configured in gcloud |
| Primary requested identity | `devanand.s2008@gmail.com` (user-provided, not yet authenticated) |

Suggested project display name: `AVS College Management System`

Suggested project ID pattern: `avs-college-management-<unique-suffix>`

## Proposed production resources requiring approval

| Resource | Proposed initial configuration | Cost behavior |
| --- | --- | --- |
| Cloud SQL for PostgreSQL | PostgreSQL 17, Enterprise edition, `db-custom-1-3840` (1 vCPU, 3.75 GiB), 20 GiB SSD, automatic storage increase, zonal pilot deployment, daily automated backup, point-in-time recovery, deletion protection | Continuous instance, storage, backup/WAL, and network charges; largest baseline cost |
| Memorystore for Redis | Basic tier, 1 GiB, private regional endpoint in `asia-south1` | Continuous instance charge; required by current BullMQ, delivery, import, backup scheduler, announcement, readiness, and multi-instance Socket.IO design |
| Cloud Run service | `avs-college-portal`, 1 vCPU, 2 GiB, min 0, max 3, concurrency 40, 300-second request timeout, CPU only during requests initially | Request, CPU, memory, outbound network; scales to zero when idle, subject to WebSocket activity |
| Cloud Run migration job | One task, no retries for unsafe ambiguity, invoked explicitly before a new revision | Charged only while executing |
| Cloud Run backup job | One task, scheduled daily plus manual/pre-migration execution | Charged only while executing, plus backup storage/network |
| Cloud Run restore-test job | Manual/scheduled controlled invocation against a temporary database | Job execution plus temporary database/storage usage |
| Cloud Storage files bucket | Regional Standard storage, private, uniform access, public access prevention, versioning/lifecycle policy | Stored data, operations, retrieval, and egress |
| Cloud Storage backups bucket | Regional Standard storage, private, uniform access, public access prevention, versioning and retention/lifecycle policy | Stored encrypted backups, operations, and restore egress |
| Cloud Storage exports bucket | Regional Standard storage, private, uniform access, public access prevention, lifecycle expiry | Stored exports, operations, and egress |
| Artifact Registry | Regional Docker repository `avs-portal` with cleanup policy | Image storage and network transfer |
| Cloud Build | Manual production build/deploy pipeline | Build-minute and worker resource usage |
| Secret Manager | Separate active secrets with least-privilege access | Active secret versions and access operations |
| Cloud Scheduler | Daily backup and monitoring/maintenance schedules | Per-job invocation pricing after any free allowance |
| Cloud Monitoring/Logging | Uptime check, dashboards, alerts, structured logs with retention controls | Ingested/stored logs, metrics, and alerting where chargeable |
| Direct VPC egress/networking | Cloud Run private access to Memorystore; firewall rules scoped to the runtime identity/network | Network processing/egress where applicable |

The zonal Cloud SQL pilot intentionally does not include regional high availability. Regional HA materially increases continuous database cost and should be enabled only after budget approval or before the portal becomes operationally critical. Point-in-time recovery is proposed because college records are difficult to reconstruct; it adds WAL storage cost.

If Memorystore cost is not approved, deployment must pause for an application redesign that replaces BullMQ with Cloud Tasks/database-backed jobs and initially caps Cloud Run at one instance for Socket.IO. Running an ephemeral Redis process inside the portal container is not an acceptable production substitute.

## Proposed resource names

Values containing `<PROJECT_ID>` remain unresolved until project approval.

- Cloud Run service: `avs-college-portal`
- Artifact Registry repository: `avs-portal`
- Container image: `asia-south1-docker.pkg.dev/<PROJECT_ID>/avs-portal/avs-college-portal:<COMMIT_SHA>`
- Cloud SQL instance: `avs-college-postgres`
- Database: `avs_college`
- Database application user: `avs_portal_app`
- Memorystore instance: `avs-college-redis`
- Files bucket: `<PROJECT_ID>-avs-files`
- Backups bucket: `<PROJECT_ID>-avs-backups`
- Exports bucket: `<PROJECT_ID>-avs-exports`
- Runtime service account: `avs-portal-runtime@<PROJECT_ID>.iam.gserviceaccount.com`
- Migration service account: `avs-portal-migration@<PROJECT_ID>.iam.gserviceaccount.com`
- Backup service account: `avs-portal-backup@<PROJECT_ID>.iam.gserviceaccount.com`
- Cloud Build service account: `avs-portal-build@<PROJECT_ID>.iam.gserviceaccount.com`
- Migration job: `avs-portal-migrate`
- Backup job: `avs-portal-backup`
- Restore-test job: `avs-portal-restore-test`

## APIs proposed for enablement

Enable only after approval and only in the selected billed project:

- `run.googleapis.com`
- `sqladmin.googleapis.com`
- `storage.googleapis.com`
- `artifactregistry.googleapis.com`
- `cloudbuild.googleapis.com`
- `secretmanager.googleapis.com`
- `iamcredentials.googleapis.com`
- `cloudscheduler.googleapis.com`
- `cloudtasks.googleapis.com` only if used by the approved queue design
- `logging.googleapis.com`
- `monitoring.googleapis.com`
- `redis.googleapis.com` because the current application requires managed Redis
- `compute.googleapis.com` and `vpcaccess.googleapis.com` only as required for private Redis networking

## Service accounts and least-privilege IAM

### Runtime service account

Proposed permissions, scoped to individual resources wherever possible:

- Cloud SQL Client;
- Secret Manager Secret Accessor only for runtime secrets;
- Storage Object User only on the files and exports buckets;
- Logging Log Writer;
- Monitoring Metric Writer;
- Service Account Token Creator on itself only if IAM-based GCS signed URLs require blob signing.

It will not receive Owner, Editor, project-wide Storage Admin, or Secret Manager Admin.

### Migration service account

- Cloud SQL Client;
- Secret Manager Secret Accessor only for the migration database connection;
- Logging Log Writer.

### Backup service account

- Cloud SQL Client;
- Storage Object Creator plus the minimum read/metadata permissions needed on the backups bucket;
- Secret Manager Secret Accessor only for database and backup-encryption secrets;
- Logging Log Writer.

### Cloud Build service account

- Artifact Registry Writer on `avs-portal`;
- Cloud Run Admin only for the named service/jobs or the narrowest deploy permissions available;
- Service Account User only on the runtime/migration/backup identities;
- Cloud Build logging permissions;
- permission to invoke the migration job and read only secrets required by that controlled step.

## Secret plan

Create separate Secret Manager secrets only when the corresponding feature is configured:

- required core: `database-url`, `database-password`, `jwt-access-secret`, `jwt-refresh-secret`, `csrf-secret`, `feedback-submission-secret`, `backup-encryption-key`;
- AI: `openai-api-key`;
- WhatsApp: `whatsapp-access-token`, `whatsapp-verify-token`, `whatsapp-app-secret`;
- Google Drive (optional and separately authorized): `google-oauth-client-secret`, `google-drive-refresh-token`, `google-drive-encryption-key`;
- email/push as configured: SMTP credentials, Firebase private key, and device-token encryption key.

No secret value will be printed, stored in repository files, passed as a frontend/build-time public variable, or embedded in a Docker layer.

## Storage and backup policy

- All buckets use uniform bucket-level access and public access prevention.
- Application objects remain private and are returned only after backend authorization or via short-lived signed URLs.
- The files bucket uses versioning only where recovery value justifies its added storage cost; lifecycle rules remove superseded versions after an approved period.
- The backups bucket stores encrypted custom-format PostgreSQL dumps, checksums, and manifests. Object versioning is enabled, and daily/weekly/monthly lifecycle retention will match the application policy after budget approval.
- The exports bucket uses a short lifecycle expiry appropriate for generated exports.
- Cloud SQL automated backups and point-in-time recovery are separate from encrypted logical backups in GCS.
- Google Drive/Google One capacity is not Cloud Storage capacity. Google Drive remains disconnected unless the user separately grants OAuth consent for an optional secondary encrypted-backup copy.

## Deployment controls

- Production deployment is manual from the approved `main` commit or a release tag.
- Images are tagged with the exact commit and `production`; the deployed digest, build ID, and revision are recorded.
- Tests, secret scans, bundle scans, dependency audit, container scan, migration, health verification, and smoke tests are fail-fast gates.
- Migrations never run during ordinary Cloud Run service startup.
- Maximum instances are finite to control database connections and cost.
- The public application, REST API, health endpoints, feedback/certificate deep links, authorized files, and WebSockets share one Cloud Run origin.
- Compiler execution remains disabled unless an approved isolated provider is configured and tested.

## Decisions required before provisioning

1. Authenticate the intended Google identity and verify that it is `devanand.s2008@gmail.com` or explicitly approve another identity.
2. Select an existing billed project or approve creation/linking of a new project matching the suggested name/ID pattern.
3. Approve the cost-bearing resource list, especially Cloud SQL and the continuously billed Memorystore instance.
4. Approve the zonal pilot database choice or request regional high availability.
5. Confirm whether optional Google Drive secondary backup remains disabled (recommended for the initial deployment).
6. Provide or authorize configuration of external providers needed for full tests: OpenAI, WhatsApp/email/Firebase, and an approved isolated compiler service. Secret values must be entered directly into Secret Manager or an interactive secure flow, never pasted into chat.

After these decisions, replace every unresolved field in this plan with the actual project/account/billing details before the first resource-creation command.
