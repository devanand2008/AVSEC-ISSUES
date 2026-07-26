# Login Password Flow

The detailed flow is maintained in `LOGIN_AND_PASSWORD_FLOW.md`.

Required behavior:

1. Admin creates or resets an account.
2. Backend stores only an Argon2id hash.
3. Backend sets `must_change_password=true`.
4. User logs in with the temporary password.
5. Frontend routes to `/change-password`.
6. Password update stores the new hash and sets:
   - `must_change_password=false`
   - `password_changed_at`
   - `first_login_completed_at`
7. Old sessions are revoked or rotated.
8. Frontend refreshes the authenticated user profile.
9. The password page does not reappear after refresh or relogin unless an admin
   reset or policy requirement sets `must_change_password=true` again.
