# Announcement and Email Guide

## Announcements

Admins can create audience-scoped announcements/posters from the Announcements area. Targeting should use college, department, programme, section, role or specific user scopes.

## Delivery

Authoritative publication is stored in PostgreSQL first. In-app notification delivery should continue even when email, push or WhatsApp providers are disabled.

Provider settings live in `.env`:

```env
EMAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
EMAIL_FROM_NAME=AVS Engineering College
EMAIL_FROM_ADDRESS=
PUSH_NOTIFICATIONS_ENABLED=false
WHATSAPP_ENABLED=false
```

## Production Setup

1. Configure institution-owned SMTP credentials.
2. Configure Firebase and WhatsApp only after sandbox testing.
3. Keep templates and provider tokens outside source control.
4. Verify failed delivery attempts appear in the Admin operations/delivery view.
5. Confirm poster images load on mobile before publishing widely.

## Safety

Email/push/WhatsApp failures must not cancel an already-saved announcement. Operators should retry failed jobs from the operations screen after fixing provider configuration.
