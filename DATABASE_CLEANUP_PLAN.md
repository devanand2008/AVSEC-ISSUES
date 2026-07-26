# Database Cleanup Plan

Updated: 16 July 2026

## Backup Gate

Fresh pre-cleanup backup created:

- Dump: `backups\college-20260716-133207.dump`
- Checksum: `backups\college-20260716-133207.dump.sha256`

The bundled `scripts\backup.ps1 -UseDocker` helper failed while reading container
environment variables, so an equivalent Docker `pg_dump --format=custom` backup
was created manually and hashed.

## Cleanup Already Completed

- Deleted one stale old-brand announcement:
  `Welcome to CampusOne`.
- Verified remaining announcement:
  `Welcome to AVS Engineering College`.

## Current Development Data

| Data Area | Count | Cleanup Position |
| --- | ---: | --- |
| College | 1 | Keep: `6201`, AVS Engineering College |
| Main Admin | 1 | Keep: Devanand / `deva1253@college.com` |
| Other seed users | 12 | Replace with real AVS users before rollout |
| Roles | 18 | Keep as baseline, review names/permissions |
| Departments | 3 | Replace or update from AVS master data |
| Rooms | 18 | Replace or update from AVS campus/location master |
| Issues | 9 | Test/demo data; remove through reviewed cleanup |
| Attendance sessions | 1 | Demo data; remove with linked records |
| Attendance records | 2 | Demo data; remove with linked session |
| Announcements | 1 | Keep current AVS welcome if desired |

## Identified Test Issue Records

Development/test issues include:

- `ISS-2026-000001`: `Ceiling fan not starting`
- `ISS-2026-000002`: `Lifecycle fan check 222308`
- `ISS-2026-000003` through `ISS-2026-000009`: Playwright fan lifecycle tickets

These issue records have status histories, assignment histories, affected users,
and possibly files/comments. They should not be deleted with ad hoc SQL unless
the linked tables are reviewed together.

## Recommended Cleanup Order

1. Confirm whether the current database is still local-only development data.
2. Export or snapshot any records that should be retained.
3. Remove issue workflow records with a transaction-aware cleanup script or admin
   archive flow.
4. Remove attendance demo session and records together.
5. Import real AVS departments, programmes, sections, staff, students, rooms,
   assets, teams, and routing rules through the existing import pipeline.
6. Re-run login, dashboard, attendance, issue reporting, import, export, and audit
   smoke tests.

## Guardrails

- Never run `docker compose down -v` on a database that may contain real data.
- Never reset migrations to clean test data.
- Keep Devanand's Main Admin account active until another verified Main Admin
  exists.
- Production cleanup requires a current production backup and restore rehearsal,
  not this local development dump.
