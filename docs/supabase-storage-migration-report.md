# Supabase Storage Migration Report

**Report date:** 2026-08-07

**Source provider:** Local MinIO

**Destination provider:** Supabase S3-compatible Storage

**Private bucket:** `college-private`
**Verification mode:** Read-only full-content comparison

This report is redacted. Access keys, secret keys, endpoints containing account
identifiers, object names, and signed URLs are not recorded.

## Result

The source and destination buckets have complete content parity for the current
source snapshot.

| Measurement | Source MinIO | Supabase | Status |
|---|---:|---:|---|
| Object count | 108 | 108 | **PASS** |
| Total bytes | 2,686,456 | 2,686,456 | **PASS** |
| Keys present in both | 108 | 108 | **PASS** |
| Objects verified by MIME metadata and SHA-256 | 108 | 108 | **PASS** |
| Missing destination objects | - | 0 | **PASS** |
| Extra destination objects | - | 0 | **PASS** |
| Size mismatches | - | 0 | **PASS** |
| Content-hash mismatches | - | 0 | **PASS** |

The 2026-08-07 verification listed both buckets, downloaded each object from
both providers, calculated SHA-256 in memory, and compared keys, sizes, MIME
metadata, and content hashes. It did not upload, overwrite, or delete any object.

## Database Reference Inventory

The authoritative PostgreSQL source contains these non-null storage references.
They are now present in the isolated database `avs_college_import_20260806`, whose
143 table counts matched the 7,425-row source snapshot exactly before transient
cleanup. The current live `avs_college` database remains bootstrap-only and its
corresponding reference-table counts remain zero until Render cutover.

| Reference | Source | Staged database | Current live | Objects available |
|---|---:|---:|---:|---:|
| Import jobs | 22 jobs | 22 jobs | 0 | 18/18 result keys and 19/22 source keys |
| Issue attachments | 29 | 29 | 0 | 29/29 primary keys |
| Message attachment uploads | 15 | 15 | 0 | 14/15 primary keys and 14/14 thumbnail keys |
| Final message attachments | 13 | 13 | 0 | 13/13 primary keys and 13/13 thumbnail keys |
| Profile photos | 0 | 0 | 0 | Not applicable |
| Announcement images | 0 | 0 | 0 | Not applicable |
| Subject resources | 0 | 0 | 0 | Not applicable |
| Model question papers | 0 | 0 | 0 | Not applicable |
| AI knowledge objects | 0 | 0 | 0 | Not applicable |

There are 124 non-null reference values representing 102 unique object keys.
Ninety-eight unique referenced keys exist in both buckets. Four references are
absent from both the authoritative MinIO bucket and Supabase:

- three `import_jobs.source_storage_key` references: two jobs are `READY` and
  one is `COMPLETED`;
- one expired `message_attachment_uploads.storage_key` reference whose upload
  status is `UPLOADING`.

These four gaps pre-date the Supabase copy because the objects are also absent
from the source bucket. They are not migration losses. No record was changed or
deleted during diagnosis. The three import-job references require an operator
decision after database cutover; the expired incomplete message upload can be
handled through the application's guarded maintenance workflow after a verified
backup.

## Executed and Pending Checks

| Check | Status |
|---|---|
| Source bucket list | **PASS** |
| Destination bucket list | **PASS** |
| Key-set equality | **PASS** |
| Byte-total equality | **PASS** |
| Full per-object MIME and SHA-256 comparison | **PASS** |
| Database-reference coverage against Supabase | **PASS: 98/102 unique references present; four pre-existing source gaps identified** |
| Atomic staged database restore carrying attachment metadata | **PASS: all source table counts matched** |
| Render cutover from bootstrap database to staged database | **PENDING** |
| Signed-download test through the deployed application | **PENDING** |
| Main Admin issue-attachment and message-attachment browser acceptance | **PENDING** |
| Cleanup of stale reference rows | **PENDING; no deletion authorized** |

## Preservation and Cutover Rules

1. Do not run a mirror command with a delete/remove option.
2. Do not empty, recreate, or change the privacy of the Supabase bucket.
3. Keep the local MinIO volume intact until the complete production rollback
   window has closed.
4. Keep Render on the current `avs_college` database until the final cutover;
   preserve `avs_college_import_20260806` and its restored storage keys.
5. After database cutover, sample a signed download from each populated domain:
   import result, issue attachment, message attachment, and thumbnail.
6. Investigate the four pre-existing stale references through application-level
   maintenance only after a fresh backup; do not repair them with direct deletes.

## Storage Acceptance Status

**Object migration passed.** All source objects are present in Supabase and their
keys, sizes, MIME metadata, and content hashes match. The PostgreSQL rows that
reference those objects are present in the isolated restored database. End-to-end
application acceptance remains **PENDING** because Render still uses the old
bootstrap database and no post-cutover signed-download transaction has run.
