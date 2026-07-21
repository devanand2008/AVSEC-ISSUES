# User Import Guide — AVS Engineering College Management System

## Overview

The Bulk Import module allows the Main Admin and authorised administrators to create hundreds of user accounts simultaneously by uploading a structured Excel (`.xlsx`/`.xls`) or CSV (`.csv`) file. This guide covers every role type, required columns, and best practices.

---

## Supported Import Types

| Import Type | Description |
|---|---|
| **Combined users (all roles)** | Use `role_codes` column to mix any role in one file |
| **Students** | Dedicated import with student-profile fields |
| **Staff — Faculty, HOD, CC, Maintenance, Admin** | All staff roles in one upload |
| **Departments** | Create academic departments |
| **Programmes** | Create degree programmes |
| **Classes / sections** | Create semesters and sections |
| **Attendance history** | Legacy data migration |
| **Campus blocks / Floors / Rooms** | Physical location structure |
| **Room assets** | Equipment in rooms |
| **Responsible persons** | Maintenance team members |
| **Issue assignment rules** | Auto-routing rules |

---

## Step-by-Step Import Process

### 1. Download the Template

1. Navigate to **Admin → Bulk Imports**
2. Select the **Import type** (e.g., *Students*)
3. Click **Download template**
4. Open the downloaded `.xlsx` file in Microsoft Excel or LibreOffice

### 2. Fill the Template

- Do NOT delete or rename the header row
- Column names in the template match the system field names
- Leave optional columns blank (do not delete their header)
- Dates must be in `YYYY-MM-DD` format (e.g., `2005-06-15`)
- Use valid role codes (see Role Codes table below)

### 3. Upload and Validate

1. Click **Choose from Gallery** or drag the file into the dropzone
2. Select **Import mode** (Create only / Create and update / Update only)
3. Click **Validate and preview**
4. Review the preview table — red rows show errors
5. Download the error report if needed

### 4. Fix Errors and Re-upload

- Correct errors in the original Excel file
- Re-upload and validate again
- Repeat until zero errors

### 5. Confirm and Monitor

- Click **Confirm N valid rows**
- The import runs in the background — track the progress bar in **Import jobs**
- When status shows **COMPLETED**, the accounts are live

### 6. Download Credentials

> **IMPORTANT**: Credentials can only be downloaded **once**. Store the file securely and delete it after distribution.

- Click **Download credentials (one-time)** in the Result report panel
- The Excel file contains: Name, College ID, Temporary Password
- Users must change their password at first login

---

## Required Columns by Role

### Students

| Column | Required | Notes |
|---|---|---|
| `college_identity_id` | Yes | Unique student login ID |
| `full_name` | Yes | |
| `role_codes` | Yes | Must be `STUDENT` |
| `department_code` | Yes | Match existing department |
| `programme_code` | Yes | Match existing programme |
| `section_code` | Yes | |
| `academic_year` | Yes | e.g., `2024-25` |
| `email` | No | Recommended |
| `mobile` | No | |
| `student_id` | No | Defaults to college_identity_id |
| `admission_year` | No | |
| `roll_number` | No | |
| `date_of_birth` | No | YYYY-MM-DD |
| `temporary_password` | No | Generated if blank |

### Staff (Faculty / HOD / Class Coordinator / Maintenance / Admin)

| Column | Required | Notes |
|---|---|---|
| `college_identity_id` | Yes | |
| `full_name` | Yes | |
| `role_codes` | Yes | See Role Codes table |
| `department_code` | No | Required for HOD, CC, Faculty |
| `employee_id` | No | Defaults to college_identity_id |
| `designation` | No | |
| `email` | No | Recommended |
| `mobile` | No | |
| `temporary_password` | No | Generated if blank |

---

## Role Codes

| Role | `role_codes` value |
|---|---|
| Student | `STUDENT` |
| Faculty | `FACULTY` |
| Class Coordinator | `CLASS_COORDINATOR` |
| Head of Department | `HOD` |
| Vice Principal | `VICE_PRINCIPAL` |
| Principal | `PRINCIPAL` |
| Admin | `ADMIN` |
| Maintenance Staff | `MAINTENANCE` |
| Security | `SECURITY` |

Multiple roles: Separate with commas, e.g., `FACULTY,CLASS_COORDINATOR`

---

## Import Modes

| Mode | Behaviour |
|---|---|
| **Create only** | Skip rows where the `college_identity_id` already exists |
| **Create and update** | Create new, update existing (merges fields) |
| **Update only** | Only update existing accounts, skip new IDs |

---

## Security Notes

- Temporary passwords are hashed using **Argon2id** — they are never stored in plain text
- Credential files are only available once per import job
- All imports are fully reversible via **Safe rollback**
- Every import action is recorded in the **Audit Log**
