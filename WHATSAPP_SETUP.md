# WhatsApp Business Cloud Setup

Create a Meta business application and approved issue template, then configure `WHATSAPP_ENABLED`, phone-number/business IDs, access token, verify token, app secret, API version, template name and language. Register `https://<api-host>/api/v1/webhooks/whatsapp` and subscribe to message status events.

The webhook challenge verifies the configured token and every POST event requires a valid `x-hub-signature-256` derived from the app secret. Events are stored idempotently and sent/delivered/read/failed statuses reconcile into delivery-attempt and WhatsApp records. Provider delivery is queued only after the application transaction commits and is retried exponentially. Disabled credentials never produce a false “sent” state. Do not include unnecessary student data in templates.
