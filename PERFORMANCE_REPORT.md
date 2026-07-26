# Performance Report

Measured: 16 July 2026 on local Docker stack  
Web: `http://localhost:3000`  
API: `http://localhost:4000/api/v1`

## Build and Static Output

- Docker web production build passed.
- Next.js generated 37 app routes.
- AVS logo was optimized from `logo\logo.png` / `avs-logo.png` at about 1.4 MB to
  `avs-logo-360.png` at about 69 KB for routine UI display.
- PWA icons are pre-generated PNGs instead of relying on a large source image.

## API Timings

Five local requests were measured after container restart. The first request is a
cold path and is shown separately.

| Request               |  Cold Run |     Warm Range |
| --------------------- | --------: | -------------: |
| `GET /health/live`    | 2861.8 ms |    5.7-20.3 ms |
| `POST /auth/login`    | 1138.0 ms | 549.6-925.1 ms |
| `GET /login` web page | 2513.2 ms | 108.1-262.1 ms |

Warm averages excluding the first request:

| Request               | Warm Average |
| --------------------- | -----------: |
| `GET /health/live`    |      10.9 ms |
| `POST /auth/login`    |     726.0 ms |
| `GET /login` web page |     198.7 ms |

## Browser Navigation Timing

Chrome/Playwright navigation to `/login`:

| Run | DOMContentLoaded | Load Event |
| --: | ---------------: | ---------: |
|   1 |          1636 ms |    1819 ms |
|   2 |           166 ms |     323 ms |
|   3 |            79 ms |     136 ms |

## Interpretation

The cold run includes container and runtime warm-up. Warm web responses and health
checks are fast for local development. Login cost is higher because password
verification uses Argon2id, which is intentional security work rather than a
simple lookup.

## Recommended Follow-Up

- Run a load test only after real AVS master data is imported.
- Track p95 and p99 login, dashboard, attendance submit, issue create, import
  preview, and file upload timings.
- Keep large original logo assets out of hot UI paths; use optimized icons for
  repeated chrome/loading views.
