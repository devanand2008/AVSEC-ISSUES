# Progress

Updated: 16 July 2026

## Done

- Audited current Next.js/NestJS/PostgreSQL architecture.
- Preserved AVS Engineering College branding and Devanand Main Admin identity.
- Created and verified fresh database and project backups.
- Added and executed transactional demo-data cleanup tooling.
- Removed duplicate non-admin Devanand account.
- Verified the configured Main Admin was the only remaining user; its identity is omitted.
- Fixed repeated password-change behavior by keeping Main Admin `must_change_password=false`.
- Consolidated Windows startup into `START_AVS_APP.bat` with LAN/mobile URL output.
- Added Compose variables for web/API LAN binding while keeping PostgreSQL/Redis/MinIO local-only.
- Added CORS allowlist support for LAN mobile URL.
- Added runtime LAN URL fallback in the web API/socket client so phones call the computer's LAN IP instead of phone-local `localhost`.
- Refreshed and committed the local Docker API/web images from verified local production builds after Docker Buildx timed out.
- Ran LAN mode on `10.181.158.176` and verified web/API/CORS/browser login.
- Added/updated audit, cleanup, backup, attendance, announcement, security, performance, mobile and test documentation.

## Validation Passed

- `npm run prisma:validate -w @college/api`
- `npm run typecheck -w @college/api`
- `npm run typecheck -w @college/web`
- `npm run cleanup:data -- --dry-run`
- `npm run lint -w @college/api`
- `npm run lint -w @college/web`
- `npm run test -w @college/api`
- `npm run test -w @college/web`
- `npm run build -w @college/api`
- `npm run build -w @college/web`
- Browser smoke on local and LAN URLs

## External Dependencies

- SMTP/Firebase/WhatsApp live delivery tests require institution credentials.
- Real phone LAN test requires the user phone to be on the same Wi-Fi as this computer.
