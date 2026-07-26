# Firebase Cloud Messaging Setup

Firebase push is implemented but optional. In-app notifications remain authoritative when Firebase is disabled or unavailable.

## Firebase project

1. Create an institution-owned Firebase project and web application.
2. Enable Cloud Messaging and create a Web Push certificate/VAPID key.
3. Create a least-privilege Admin SDK service account and store its values only in the API secret manager.
4. Restrict the public web application configuration to approved origins where Firebase supports that control.

API secrets:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
DEVICE_TOKEN_ENCRYPTION_KEY
```

Browser build variables:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_VAPID_KEY
```

`DEVICE_TOKEN_ENCRYPTION_KEY` must be a separate high-entropy production secret. Rotate it only with a device re-registration plan because existing ciphertext becomes unreadable.

## Behavior

- The notifications page requests browser consent and registers the FCM token after the user opts in.
- The API stores encrypted token ciphertext plus a SHA-256 uniqueness hash; list responses never expose tokens.
- Multicast responses disable invalid or unregistered tokens.
- The service worker displays/links background notifications.
- Provider failures are retried through BullMQ and permanently failed jobs appear in `/admin/operations`.
- Push failure never rolls back authoritative application data or in-app notifications.

## Verification

Use a non-production Firebase project first. Test consent denied/granted, multiple devices, token refresh, logout/device removal, invalid-token cleanup, background/foreground delivery, deep links, provider outage, and retry/resolve behavior. Do not place service-account JSON or private keys in the web bundle, repository, logs, or support screenshots.
