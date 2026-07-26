# Attendance Timing Configuration

Default timezone: `Asia/Kolkata`  
Default opening time: `09:30`

## Environment Defaults

`.env.example` documents:

```env
DEFAULT_TIMEZONE=Asia/Kolkata
ATTENDANCE_DEFAULT_OPEN_TIME=09:30
ATTENDANCE_DEFAULT_CLOSE_TIME=
```

The closing time is intentionally configurable and should not be hardcoded.

## Expected Rules

- Server time controls attendance windows, not the browser clock.
- Main Admin has override access before and after the normal window.
- HOD/CC users can mark only during configured windows unless reopened by an admin.
- Admin can reopen, extend, lock or correct attendance when policy permits.
- Date-specific schedules should be stored in database settings rather than frontend constants.

## Test Matrix

- 09:29 IST: CC/HOD marking closed.
- 09:30 IST: configured class window opens.
- After close: CC/HOD marking disabled; view remains available.
- Admin: can mark/edit at any time with reason/history.
- Browser clock manipulation: must not bypass backend checks.
