# AVS COLLEGE MANAGEMENT SYSTEM

# FINAL PRODUCTION RELEASE REPORT

**Report state:** PRE-DEPLOYMENT DRAFT  
**Last updated:** 2026-08-09 (Asia/Kolkata)

Repository:  
`https://github.com/devanand2008/AVSEC-ISSUES`

Commit deployed:  
PENDING — release candidate not yet committed or deployed

Render deployment ID:  
PENDING — do not reuse the previous deployment ID

Render revision:  
`main` at PENDING RELEASE COMMIT

PUBLIC URL:  
`https://avs-college-portal.onrender.com`

API:  
`https://avs-college-portal.onrender.com/api/v1`

Health:  
`https://avs-college-portal.onrender.com/health`  
PENDING POST-DEPLOY — the existing deployment baseline returns HTTP 200.

## DATABASE CUTOVER

Old database:  
Redacted; retained for rollback and not deleted.

New production database:  
`avs_college_import_20260806`

Render was already targeting the verified restored database when authorised
control-plane access became available. No `DATABASE_URL` change was required or
performed during this repair run.

Old database backup:  
PASS — PostgreSQL 17 custom archive, `--no-owner`, `--no-privileges`, SHA-256
`23EB635C44A1AD728796D1485520EA73E9704A5582476E2C3CF11042F12DEE4C`,
143 table-data entries, Prisma history present, isolated restore verified,
AES-256-GCM encrypted, authenticated decryption verified, plaintext removed.

New database backup:  
PASS — pre-rotation SHA-256
`EB9D296A36B14C13212955C2987BA2BF8CD49B8F5B5E7BC56B7D65D2A95AAA37`;
post-Main-Admin-rotation recovery archive SHA-256
`94DA3D62438678ED4B7F0872FC95860343D75EE1DAC48996AE2DC949B7D6B043`.
Both contain 143 table-data entries and Prisma history, passed isolated restore,
were AES-256-GCM encrypted, passed authenticated decryption, and had their
plaintext archives securely removed.

Expected tables:  
143

Actual tables:  
143

Expected restored rows:  
7,425 source-snapshot baseline

Actual production rows:  
6,485 at the verified post-rotation recovery snapshot. The difference from the
source snapshot is primarily verified cleanup of transient sessions, refresh
tokens, and idempotency records plus legitimate production activity. Re-query
after final live acceptance.

Users: 41  
Issues: 23  
Messages: 69  
Announcements: 1

AVS Skill courses: 17  
AVS Skill modules: 34  
AVS Skill lessons: 513  
AVS Skill assessments: 1,019  
AVS Skill progress: 45  
AVS Skill certificates: 2

Main Admin:  
PASS — the exposed credential was invalidated, the replacement credential is
retained outside Git, and ACTIVE `MAIN_ADMIN` role and authentication were
validated.

Main Admin live login:  
PASS — password rotation, re-login, `/auth/me`, logout, session revocation, and
offline old-password invalidation checks passed through the current live app.

## LIVE FUNCTIONAL ACCEPTANCE

Add Person: PENDING POST-DEPLOY  
Add Person PostgreSQL persistence: PENDING POST-DEPLOY AND REDEPLOY  
People CRUD: PENDING POST-DEPLOY  
Campus CRUD: PENDING POST-DEPLOY  
Announcement custom title: PENDING POST-DEPLOY  
Profile workflow: PENDING POST-DEPLOY — local navigation fix builds and tests  
Reports navigation/export: PENDING POST-DEPLOY — local route fixes build and test  
Attendance: PENDING POST-DEPLOY  
Half-day attendance: PENDING POST-DEPLOY  
Attendance correction: PENDING POST-DEPLOY  
Issue Reporting: PENDING POST-DEPLOY  
Repeated Issues: PENDING POST-DEPLOY  
Maintenance: PENDING POST-DEPLOY  
Messenger: PENDING POST-DEPLOY  
Broadcast recipients: PENDING POST-DEPLOY  
Feedback QR: PENDING POST-DEPLOY  
QR real HTTPS: PENDING POST-DEPLOY  
AVS Learn: PENDING POST-DEPLOY  
AVS Skill: PENDING POST-DEPLOY  
Compiler: PENDING POST-DEPLOY  
Certificate: PENDING POST-DEPLOY  
AVS Bot: PENDING POST-DEPLOY

Supabase/object storage:  
PENDING POST-DEPLOY — private inventory passed; the repaired application-signed
download endpoint requires live acceptance.

Stored-object integrity:  
PASS — all 108 private objects were downloaded and their hash, MIME type, and
size verified. Four pre-existing historical missing database references remain
documented (two READY import sources, one COMPLETED import source, and one
abandoned UPLOADING message attachment).

## PWA AND BROWSER ACCEPTANCE

PWA install: NOT RUN AGAINST RELEASE CANDIDATE  
Installed-PWA login: NOT RUN AGAINST RELEASE CANDIDATE  
PWA deep links: NOT RUN AGAINST RELEASE CANDIDATE  
Service worker: PENDING POST-DEPLOY — anonymous pre-fix baseline passed  
Chrome automation: NOT RUN AGAINST DEPLOYED RELEASE CANDIDATE  
Physical camera: NOT AVAILABLE  
Firefox: NOT AVAILABLE  
Edge: NOT RUN AGAINST RELEASE CANDIDATE — pre-fix anonymous smoke passed  
Responsive: PENDING POST-DEPLOY — local 320x568 fix and geometry test pass

## SECURITY AND QUALITY GATES

NODE_ENV: production  
CORS: PENDING POST-DEPLOY — local denial fix and tests pass  
Secure cookies: PENDING LIVE AUTHENTICATED VERIFICATION  
CSP: PENDING LIVE HEADER VERIFICATION  
HSTS: PENDING POST-DEPLOY — local frontend/PWA header tests pass  
Rate limiting: PENDING LIVE VERIFICATION  
Secret scan: PASS — no sensitive files, private keys, or known exposed password tracked  
Dependency audit: PASS — full npm audit reports zero vulnerabilities  
RBAC: PASS — automated regression coverage  
IDOR: PASS — automated regression coverage  
QR security: PASS — automated regression coverage

Backend full suite:  
Total: 438  
Passed: 438  
Failed: 0  
Skipped: 0  
Duration: 106.627 seconds (Node 22 release-candidate run)

Web tests:  
Total: 116  
Passed: 116  
Failed: 0

Playwright:  
Total: NOT RUN AGAINST DEPLOYED RELEASE CANDIDATE  
Passed: NOT APPLICABLE  
Failed: NOT APPLICABLE  
Skipped: NOT APPLICABLE

Load test:  
NOT RUN

## REMAINING RELEASE GATES

Remaining BLOCKERS:

1. The release commit is not deployed and fresh post-deploy health/browser
   checks have not run.
2. Required production transaction acceptance, persistence across a Render
   redeploy, and dependency-safe TEST-data cleanup have not run.
3. Scheduled encrypted off-host backup remains unconfigured/degraded; no fresh
   successful off-host backup and restore-test record exists in production.

Remaining CRITICAL:  
None known from completed pre-deployment checks.

Remaining HIGH:

1. Live verification of Profile, Reports, CORS, HSTS, and application-signed
   storage downloads remains pending.
2. Production provider/application secret-rotation evidence beyond the Main
   Admin credential is incomplete.

Remaining MEDIUM:  
Installed-PWA, full Edge/Firefox browser matrix, physical-camera testing, and
controlled load testing remain incomplete.

Manual actions still required:

1. Deploy the exact release commit and record its commit and Render deployment ID.
2. Run the required live transaction workflow, redeploy persistence check, and
   remove only clearly marked TEST data.
3. Configure an authorised off-host backup destination and verify a scheduled
   encrypted backup plus restore-test metadata.
4. Complete remaining secret-rotation validation without changing
   `PASSWORD_PEPPER` blindly.
5. Complete remaining device/browser/load checks and obtain authorised human
   sign-off.

PRODUCTION RELEASE DECISION:  
**BLOCKED**
