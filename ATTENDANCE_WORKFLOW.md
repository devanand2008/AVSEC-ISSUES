# Attendance Workflow

## Roles

- Main Admin can view, create, submit and edit attendance across the college.
- HOD and Class Coordinator access is scoped to assigned departments/classes.
- Students view their own attendance only.
- Faculty marking remains configurable and should be enabled only by an administrator.

## Admin Class Entry Flow

1. Login as Devanand Main Admin.
2. Open `Attendance`.
3. Select the class/section context.
4. Use the class-student entry panel to add students to the selected class.
5. Use roster controls to mark all present/absent or set individual statuses.
6. Submit attendance.

Supported statuses include Present, Absent, Late, On Duty and Leave where the backend configuration allows them.

## Records and History

Attendance is stored in sessions and records. Admin edits should include the reason and produce attendance history/audit entries so corrections are not silent overwrites.

## Mobile Behavior

On small screens, attendance must use readable cards or responsive rows, large touch targets and no horizontal page scrolling. The admin sidebar is separate from page scrolling, and mobile users should use the bottom navigation/drawer.
