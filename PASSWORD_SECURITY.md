# Password Security

Implemented rules:

- Password hashes use Argon2id.
- Plaintext passwords are not stored in the user table.
- Imported and manually generated temporary passwords force first-login password change.
- Admin password reset requires the `users.reset_password` permission.
- Password change rejects reuse of the temporary/current password.
- Other sessions and refresh tokens are revoked after password change or temporary password reset.
- The current session receives rotated access, refresh, and CSRF cookies after a successful password change.
- Admin-generated temporary passwords use browser `crypto.getRandomValues`.

Operational guidance:

- Share temporary credentials only through trusted channels.
- Delete local spreadsheets containing temporary passwords after distribution.
- Use the admin reset flow when a temporary password must be regenerated.
- Run `npm run seed -w @college/api` or the production seed step after deployment if a database is missing the `MAINTENANCE_STAFF` role.
