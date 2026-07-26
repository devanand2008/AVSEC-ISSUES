# Login And Password Flow

Users sign in with college identity ID or email, plus college code when required.

First-login flow:

1. Admin creates, imports, or resets an account.
2. Backend stores `must_change_password = true`.
3. User logs in with the temporary password.
4. The app routes the user to `/change-password`.
5. User enters the temporary password and a new private password.
6. Backend hashes the new password, clears `must_change_password`, updates `password_changed_at`, sets `first_login_completed_at` when needed, revokes other sessions, rotates cookies, and returns fresh user state.
7. Frontend refreshes `/auth/me`, updates the auth cache, and redirects to the dashboard.

Mobile and browser-back behavior:

- Private pages continue to guard users who must change passwords.
- The auth provider refreshes `/auth/me` when a page is restored from the browser back-forward cache.
- The service worker does not cache private navigation responses.
- The password page shows a derived redirect notice when the password has already been changed, avoiding stale first-login loops.
