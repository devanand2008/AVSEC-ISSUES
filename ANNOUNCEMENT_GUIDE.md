# Announcement Guide

Detailed announcement and delivery behavior is documented in
`ANNOUNCEMENTS_GUIDE.md` and `ANNOUNCEMENT_AND_EMAIL_GUIDE.md`.

Implemented announcement surfaces include:

- Admin announcement list and create pages.
- Image/general/emergency/event/academic placement-style announcement support.
- Audience targeting.
- Recipient records.
- In-app delivery and notification integration.
- Email delivery attempts through the delivery system.
- User announcement history.
- One-time popup support through recipient display/view state.
- Analytics from real recipient and read/open data.

Operational checks:

- Suspended or archived users must not be included in active recipient creation.
- Email failures must not cancel in-app publication.
- Viewed/open counts must be sourced from database records, not browser storage.
