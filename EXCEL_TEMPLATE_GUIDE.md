# Excel Template Guide

## Student Columns

Required for student rows:

- `student_id`
- `full_name` or `student_name`
- `department_code`
- `programme_code`
- `section_code` or `section`
- `admission_year` or a year inside `academic_year`

Optional:

- `email`
- `mobile_number`
- `whatsapp_number`
- `temporary_password`
- `roll_number`
- `legacy_id`
- `gender`
- `date_of_birth`
- `parent_name`
- `parent_mobile_number`
- `blood_group`
- `address`
- `profile_photo_url`
- `batch`
- `semester_number`
- `account_status`

## Staff Columns

Required for staff/admin rows:

- `employee_id`
- `full_name` or `name`
- `role` or `role_codes`

Optional:

- `email`
- `mobile_number`
- `whatsapp_number`
- `temporary_password`
- `department_code`
- `designation`
- `date_of_joining`
- `account_status`
- `assigned_block`
- `assigned_floor`
- `assigned_room`
- `specialization`
- `assigned_issue_category`
- `shift`

## Assignment Columns

Class Coordinator and Class Representative rows may include:

- `department_code`
- `programme_code`
- `section_code`
- `academic_year`

Faculty subject rows may include:

- `department_code`
- `programme_code`
- `section_code`
- `semester_number`
- `subject_code`
- `academic_year`

## Common Aliases

The importer accepts common school/college-style headings such as:

- `employee_or_student_id`
- `login_id`
- `name_of_student`
- `department`, `dept`, `dept_code`, `department_name`
- `programme`, `program`, `program_code`
- `mobile`, `phone`, `contact_number`
- `mobile_no`, `phone_no`, `contact_no`

If headers are unusual, use the preview column mapping controls to map each source column to a system field before confirming.

Use `Auto detect` to let the importer normalize a column by itself. Use `Do not import` for extra columns that should be skipped.

## Role Aliases

Accepted aliases include:

- `CC` -> `CLASS_COORDINATOR`
- `CR`, `REP`, `CLASS_REP` -> `CLASS_REPRESENTATIVE`
- `LABORATORY_TECHNICIAN` -> `LAB_TECHNICIAN`
- `MAINTENANCE STAFF`, `MAINTENANCE_STAFF` -> `MAINTENANCE_STAFF`

## Excel Safety

Formula cells are rejected. Text values beginning with spreadsheet formula characters are reported during preview. Paste values before upload and correct any flagged rows before confirming.
