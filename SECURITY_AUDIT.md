# Security Audit

Date: 16 July 2026

## 2026-07-19 Final Master Pass

- Production high-severity audit gate passed with
  `npm audit --omit=dev --audit-level=high`.
- Remaining production advisories are moderate transitive advisories in Prisma
  dev tooling, Next/PostCSS and uuid dependency chains; npm's suggested fixes
  require breaking changes and were not applied blindly.
- Removed the disconnected root legacy Vite app and its direct root `vite`
  dependency surface.
- Confirmed the maintained import implementation continues to avoid adding the
  vulnerable `xlsx` package.
- Confirmed only `START_AVS_APP.bat` remains; old launchers that printed default
  passwords were removed.
- Fresh DB backup is still blocked by Docker CLI timeout and missing local
  `pg_dump`; destructive cleanup remains disabled until that is resolved.

## Controls Present

- Argon2id password hashing through the API authentication layer.
- Secure access and refresh session model with cookie support.
- CSRF/origin checks and a CORS allowlist.
- Backend permission and scope guards; frontend navigation is not the security boundary.
- Prisma parameterized queries and DTO validation with `whitelist` and `forbidNonWhitelisted`.
- Rate limiting configuration for global and login requests.
- Helmet security headers and API compression.
- Private MinIO/S3 uploads with signed URL flow.
- Audit logs for sensitive actions, including confirmed data cleanup.
- Database ports, Redis and MinIO ports are bound to `127.0.0.1` in development Compose.

## Changes Made

- CORS now combines `CORS_ALLOWED_ORIGINS` with `WEB_URL` and removes duplicates.
- `docker-compose.yml` supports `API_BIND_ADDRESS` and `WEB_BIND_ADDRESS`; default remains localhost.
- LAN runner sets only web/API to `0.0.0.0`; database services are not exposed to phones.
- `.env.example` documents placeholders for secrets and LAN variables.
- Cleanup preserves audit history by detaching deleted demo actors instead of deleting audit rows.
- Web runtime URL fallback converts build-time localhost API/socket URLs to the current LAN host when the app is opened from a phone.

## Current Admin State

`ADM001 / Devanand / deva1253@college.com` is the only user after cleanup. The account is active and `must_change_password=false`, so the password-change page should not repeat on every login.

## Required Production Hardening

- Replace all example secrets in `.env`.
- Enable TLS and secure cookies.
- Use exact production CORS origins.
- Store backups encrypted and off-host.
- Review SMTP/Firebase/WhatsApp provider keys and rotate them through secret management.
- Run dependency audit before every deployment.
- Keep database, Redis and object storage private behind trusted network rules.
- Replace the local LAN CSP allowance with exact production API/socket origins for public deployment.
