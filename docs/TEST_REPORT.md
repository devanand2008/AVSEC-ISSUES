# Test Report

Canonical detailed report: `../TEST_REPORT.md`.

## Latest Run

Date: 2026-07-19

Passed:

- Required `docs/` file existence check.
- `npm install --package-lock-only --ignore-scripts`.
- `npm run test:all`.
- `npm audit --omit=dev --audit-level=high`.
- `cmd.exe /c START_AVS_APP.bat --check`.
- Runtime smoke checks for web and API.

## Unified Gate

`npm run test:all` runs:

```text
Prisma validation
TypeScript checks
Lint checks
API tests
Web tests
Production build
```

Results:

- API Jest: 27 suites passed, 230 tests passed.
- Web Vitest: 9 files passed, 32 tests passed.
- Next.js production build generated 68 app routes.

## Audit

`npm audit --omit=dev --audit-level=high` passed. Remaining production findings
are moderate transitive advisories requiring breaking dependency changes.

## Runtime Smoke

- `http://localhost:3100/login` returned 200.
- `http://localhost:4100/api/v1/health/live` returned 200.

## Notes

`pnpm` is not installed on this machine, so `pnpm test:all` could not be run
locally. The `test:all` package script is present for pnpm environments.
