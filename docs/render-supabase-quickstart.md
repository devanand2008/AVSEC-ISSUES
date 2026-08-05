# Render + Supabase deployment quick start

This is the supported low-cost deployment path for the AVS College Management System:

- Render runs one Docker web service containing the website and API.
- Render creates one free Redis-compatible Key Value service for queues and realtime delivery.
- Supabase supplies persistent PostgreSQL and private S3-compatible file storage.
- Render generates and retains all application authentication secrets.

Do not upload the repository's local `.env` file to Render. Its database and object-storage URLs point to services on the local computer and cannot be reached from Render.

## 1. Create the Supabase project

1. Create a Supabase project in a region close to Render Singapore.
2. Store the database password in a password manager.
3. In **Connect**, copy the **Session pooler** PostgreSQL connection string on port `5432`. Replace the password placeholder if Supabase has not already done so. This is `DATABASE_URL`.
4. In **Storage**, create a private bucket named `college-private`.
5. In the project's S3 settings, generate an S3 access-key pair and copy the endpoint, region, access key ID, and secret access key. S3 credentials are server-only secrets.

## 2. Create the Render Blueprint

Open:

<https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fdevanand2008%2FAVSEC-ISSUES>

Create a new Blueprint from `render.yaml`. Do not reuse the existing native Node service: the supported service uses the repository's root Dockerfile and serves both the API and website.

Render asks for only these values:

| Variable                     | Value                                               |
| ---------------------------- | --------------------------------------------------- |
| `DATABASE_URL`               | Supabase Session pooler URL on port `5432`          |
| `S3_ENDPOINT`                | Supabase S3 endpoint, ending in `/storage/v1/s3`    |
| `S3_REGION`                  | Region shown in Supabase S3 settings                |
| `S3_BUCKET`                  | `college-private`                                   |
| `S3_ACCESS_KEY`              | Generated Supabase S3 access key ID                 |
| `S3_SECRET_KEY`              | Generated Supabase S3 secret access key             |
| `DEVELOPMENT_ADMIN_EMAIL`    | Email address for the first Main Admin              |
| `DEVELOPMENT_ADMIN_PASSWORD` | Unique temporary password of at least 12 characters |

Render generates the JWT, refresh-token, CSRF, QR, feedback, backup-trigger, and password-pepper secrets. It also supplies the public URL and Redis connection automatically.

## 3. Wait for first deployment

The container validates production settings, confirms migration safety, applies Prisma migrations, creates the initial college/RBAC/Main Admin records idempotently, and starts the API and website behind one public port.

The initial build can take several minutes. A successful deploy logs both of these messages:

```text
[gateway] listening on 0.0.0.0:10000
Connected to PostgreSQL
```

## 4. Verify and sign in

1. Open the Blueprint service URL.
2. Open `/health` and confirm the response reports `ok`.
3. Open `/health/ready` and confirm the database is connected.
4. Sign in with college code `6201`, identity `ADM001`, and the temporary password.
5. Change the password when prompted.

Keep the old native Node service until this Docker service passes its health check. Afterward, suspend or delete the old failed service to avoid duplicate builds.

## Provider notes

Supabase's free plan is suitable for evaluation and small deployments but currently pauses projects after one week of inactivity and does not include automatic database backups. Render free web services spin down after 15 minutes without traffic, and free Key Value storage is not persistent across restarts. Upgrade the relevant services before treating the deployment as production-critical.
