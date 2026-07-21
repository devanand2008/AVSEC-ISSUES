import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env") });

const adminEmail = (process.env.DEVELOPMENT_ADMIN_EMAIL ?? "deva1253@college.com").toLowerCase();
const collegeCode = process.env.DEVELOPMENT_COLLEGE_CODE ?? "6201";
const postgresDb = process.env.POSTGRES_DB || "college_management";
const postgresUser = process.env.POSTGRES_USER || "college_app";
const demoCollegeIds = [
  "SUPER001",
  "PRN001",
  "VP001",
  "HOD-CSE",
  "FAC101",
  "CC-CSE3A",
  "STU26001",
  "STU26002",
  "MNT001",
  "ELEC001",
  "PLMB001",
  "IT001",
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function textArray(values: string[]): string {
  return `array[${values.map(sqlLiteral).join(",")}]::text[]`;
}

function uuidArraySelect(table: string): string {
  return `array(select id from ${table})`;
}

function runPsql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", postgresUser, "-d", postgresDb, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function targetSql(selectExpression: string): string {
  return `
with college as (
  select id from colleges where code = ${sqlLiteral(collegeCode)}
),
admin_user as (
  select id, public_id, full_name, email, college_identity_id
    from users
   where college_id = (select id from college)
     and normalized_email = ${sqlLiteral(adminEmail)}
     and college_identity_id = 'ADM001'
),
demo_users as (
  select id, college_identity_id, full_name, email
    from users
   where college_id = (select id from college)
     and college_identity_id = any(${textArray(demoCollegeIds)})
),
sample_issues as (
  select id, issue_number
    from issues
   where college_id = (select id from college)
     and (issue_number = 'ISS-2026-000001'
       or issue_number like 'DEMO-%'
       or reporter_id = any(${uuidArraySelect("demo_users")})
       or assigned_to_id = any(${uuidArraySelect("demo_users")}))
),
demo_attendance_sessions as (
  select distinct s.id
    from attendance_sessions s
    left join attendance_records r on r.session_id = s.id
    left join subjects sub on sub.id = s.subject_id
    left join sections sec on sec.id = s.section_id
   where s.faculty_id = any(${uuidArraySelect("demo_users")})
      or r.student_user_id = any(${uuidArraySelect("demo_users")})
      or (s.session_date = date '2026-07-14' and sub.code = 'CS501' and sec.code = 'A')
),
demo_attendance_records as (
  select id
    from attendance_records
   where session_id = any(${uuidArraySelect("demo_attendance_sessions")})
      or student_user_id = any(${uuidArraySelect("demo_users")})
),
demo_conversations as (
  select distinct c.id
    from conversations c
    left join conversation_participants p on p.conversation_id = c.id
   where c.college_id = (select id from college)
     and ((c.official_key like 'section:%' and p.user_id = any(${uuidArraySelect("demo_users")}))
       or c.issue_id = any(${uuidArraySelect("sample_issues")}))
),
demo_messages as (
  select id
    from messages
   where conversation_id = any(${uuidArraySelect("demo_conversations")})
      or sender_id = any(${uuidArraySelect("demo_users")})
),
demo_announcements as (
  select id, title
    from announcements
   where college_id = (select id from college)
     and (title = 'Welcome to AVS Engineering College'
       or title ilike '%Development%'
       or message ilike '%development seed%')
)
${selectExpression}`;
}

function reportSql(mode: string): string {
  return targetSql(`
select jsonb_pretty(jsonb_build_object(
  'mode', ${sqlLiteral(mode)},
  'adminFound', exists(select 1 from admin_user),
  'report', jsonb_build_object(
    'demoUsers', (select count(*) from demo_users),
    'demoUserCollegeIds', (select coalesce(jsonb_agg(college_identity_id order by college_identity_id), '[]'::jsonb) from demo_users),
    'sampleIssues', (select count(*) from sample_issues),
    'sampleIssueNumbers', (select coalesce(jsonb_agg(issue_number order by issue_number), '[]'::jsonb) from sample_issues),
    'issueStatusHistories', (select count(*) from issue_status_histories where issue_id = any(${uuidArraySelect("sample_issues")})),
    'issueAssignmentHistories', (select count(*) from issue_assignment_histories where issue_id = any(${uuidArraySelect("sample_issues")})),
    'attendanceSessions', (select count(*) from demo_attendance_sessions),
    'attendanceRecords', (select count(*) from demo_attendance_records),
    'attendanceChangeHistories', (select count(*) from attendance_change_histories where record_id = any(${uuidArraySelect("demo_attendance_records")})),
    'conversations', (select count(*) from demo_conversations),
    'messages', (select count(*) from demo_messages),
    'announcements', (select count(*) from demo_announcements),
    'announcementTitles', (select coalesce(jsonb_agg(title order by title), '[]'::jsonb) from demo_announcements),
    'notificationRecipients', (select count(*) from notification_recipients where user_id = any(${uuidArraySelect("demo_users")})),
    'notificationDeliveryAttempts', (select count(*) from notification_delivery_attempts where recipient_user_id = any(${uuidArraySelect("demo_users")})),
    'auditLogsForDemoUsers', (select count(*) from audit_logs where actor_id = any(${uuidArraySelect("demo_users")})),
    'preservedAdmin', (select to_jsonb(admin_user) from admin_user)
  )
));`);
}

function cleanupSql(report: unknown, backupFile: string): string {
  return `
begin;
create temp table cleanup_college as select id from colleges where code = ${sqlLiteral(collegeCode)};
create temp table cleanup_admin as
  select id, public_id, full_name, email, college_identity_id
    from users
   where college_id = (select id from cleanup_college)
     and normalized_email = ${sqlLiteral(adminEmail)}
     and college_identity_id = 'ADM001';
create temp table cleanup_demo_users as
  select id, college_identity_id, full_name, email
    from users
   where college_id = (select id from cleanup_college)
     and college_identity_id = any(${textArray(demoCollegeIds)});
create temp table cleanup_sample_issues as
  select id, issue_number
    from issues
   where college_id = (select id from cleanup_college)
     and (issue_number = 'ISS-2026-000001'
       or issue_number like 'DEMO-%'
       or reporter_id = any(array(select id from cleanup_demo_users))
       or assigned_to_id = any(array(select id from cleanup_demo_users)));
create temp table cleanup_attendance_sessions as
  select distinct s.id
    from attendance_sessions s
    left join attendance_records r on r.session_id = s.id
    left join subjects sub on sub.id = s.subject_id
    left join sections sec on sec.id = s.section_id
   where s.faculty_id = any(array(select id from cleanup_demo_users))
      or r.student_user_id = any(array(select id from cleanup_demo_users))
      or (s.session_date = date '2026-07-14' and sub.code = 'CS501' and sec.code = 'A');
create temp table cleanup_attendance_records as
  select id
    from attendance_records
   where session_id = any(array(select id from cleanup_attendance_sessions))
      or student_user_id = any(array(select id from cleanup_demo_users));
create temp table cleanup_conversations as
  select distinct c.id
    from conversations c
    left join conversation_participants p on p.conversation_id = c.id
   where c.college_id = (select id from cleanup_college)
     and ((c.official_key like 'section:%' and p.user_id = any(array(select id from cleanup_demo_users)))
       or c.issue_id = any(array(select id from cleanup_sample_issues)));
create temp table cleanup_messages as
  select id
    from messages
   where conversation_id = any(array(select id from cleanup_conversations))
      or sender_id = any(array(select id from cleanup_demo_users));
create temp table cleanup_announcements as
  select id, title
    from announcements
   where college_id = (select id from cleanup_college)
     and (title = 'Welcome to AVS Engineering College'
       or title ilike '%Development%'
       or message ilike '%development seed%');

do $$
begin
  if not exists (select 1 from cleanup_admin) then
    raise exception 'Main Admin not found. Cleanup refused.';
  end if;
  if exists (select 1 from cleanup_demo_users where id = (select id from cleanup_admin)) then
    raise exception 'Main Admin was included in demo targets. Cleanup refused.';
  end if;
  if exists (select 1 from attendance_change_histories where record_id in (select id from cleanup_attendance_records)) then
    raise exception 'Target attendance records have immutable change history. Review before deleting.';
  end if;
end $$;

delete from notification_delivery_attempts where recipient_user_id in (select id from cleanup_demo_users);
delete from notification_recipients where user_id in (select id from cleanup_demo_users);
delete from message_attachments where message_id in (select id from cleanup_messages);
delete from message_read_receipts where message_id in (select id from cleanup_messages);
delete from message_reactions where message_id in (select id from cleanup_messages);
delete from reported_messages where message_id in (select id from cleanup_messages);
delete from messages where id in (select id from cleanup_messages);
delete from conversation_participants where conversation_id in (select id from cleanup_conversations);
delete from conversations where id in (select id from cleanup_conversations);
delete from announcements where id in (select id from cleanup_announcements);
delete from issue_attachments where issue_id in (select id from cleanup_sample_issues);
delete from issue_comments where issue_id in (select id from cleanup_sample_issues);
alter table issue_status_histories disable trigger user;
delete from issue_status_histories where issue_id in (select id from cleanup_sample_issues);
alter table issue_status_histories enable trigger user;
alter table issue_assignment_histories disable trigger user;
delete from issue_assignment_histories where issue_id in (select id from cleanup_sample_issues);
alter table issue_assignment_histories enable trigger user;
delete from issue_escalations where issue_id in (select id from cleanup_sample_issues);
delete from resolution_verifications where issue_id in (select id from cleanup_sample_issues);
delete from issue_affected_users where issue_id in (select id from cleanup_sample_issues);
delete from issues where id in (select id from cleanup_sample_issues);
delete from attendance_correction_requests where session_id in (select id from cleanup_attendance_sessions);
delete from attendance_records where id in (select id from cleanup_attendance_records);
delete from attendance_sessions where id in (select id from cleanup_attendance_sessions);
delete from faculty_subject_assignments where faculty_id in (select id from cleanup_demo_users);
delete from class_coordinator_assignments where coordinator_id in (select id from cleanup_demo_users);
delete from class_representative_assignments where representative_id in (select id from cleanup_demo_users);
delete from responsible_team_members where user_id in (select id from cleanup_demo_users);
delete from student_profiles where user_id in (select id from cleanup_demo_users);
delete from staff_profiles where user_id in (select id from cleanup_demo_users);
alter table audit_logs disable trigger user;
update audit_logs
   set after_value = jsonb_build_object(
        'previousAfterValue', after_value,
        'cleanupDetachedActorId', actor_id,
        'cleanupDetachedReason', 'Demo user removed by cleanup-demo-data'
      ),
      actor_id = null
 where actor_id in (select id from cleanup_demo_users);
alter table audit_logs enable trigger user;
delete from users where id in (select id from cleanup_demo_users);

insert into audit_logs (id, college_id, actor_id, action, entity_type, before_value, after_value, reason, request_id)
values (
  gen_random_uuid(),
  (select id from cleanup_college),
  (select id from cleanup_admin),
  'data_cleanup.demo_data',
  'DataCleanup',
  ${sqlLiteral(JSON.stringify(report))}::jsonb,
  ${sqlLiteral(JSON.stringify({ confirmed: true, backupFile }))}::jsonb,
  'Confirmed demo/sample data cleanup preserving Devanand Main Admin.',
  'cleanup-demo-data:' || extract(epoch from clock_timestamp())::text
);
commit;`;
}

const confirmed = process.argv.includes("--confirm");
const dryRun = process.argv.includes("--dry-run") || !confirmed;
const backupFile = arg("--backup-file");
const mode = dryRun ? "dry-run" : "confirm";
const report = JSON.parse(runPsql(reportSql(mode)));

console.log(JSON.stringify(report, null, 2));

if (!report.adminFound) throw new Error(`Main Admin ${adminEmail} / ADM001 was not found. Cleanup refused.`);
if (dryRun) process.exit(0);
if (!backupFile) throw new Error("Confirmed cleanup requires --backup-file <verified dump path>.");
if (!existsSync(resolve(backupFile))) throw new Error(`Backup file not found: ${backupFile}`);
if (Number(report.report.attendanceChangeHistories) > 0) {
  throw new Error("Confirmed cleanup refused because target attendance records have immutable change history.");
}

runPsql(cleanupSql(report.report, resolve(backupFile)));
console.log("Confirmed demo-data cleanup completed.");
