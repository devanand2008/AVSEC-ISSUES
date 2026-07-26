# Login Password Flow

Canonical guide: `../LOGIN_PASSWORD_FLOW.md`.

Temporary passwords are stored only as hashes. The password creation page is
controlled by database-backed `must_change_password` state and refreshed user
profile data.
