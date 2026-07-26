# AVS Engineering College - Announcements Feature Guide

This guide details the implementation and operation of the instant image announcements feature.

## 1. Feature Overview

The Announcements feature allows college administration to broadcast messages and images to specific audiences (roles, departments, or the entire college). It includes:
- **Rich Media**: Attach high-quality images to announcements.
- **Auto-Display**: Unread announcements automatically pop up once per recipient after login and password-change checks.
- **Granular Tracking**: Tracks delivery, display, view (min 2 seconds), and explicit acknowledgement.
- **Analytics**: Admin dashboard to track the exact funnel of announcement reach.

## 2. Technical Implementation

### 2.1 Backend Architecture

- **`Announcement` Model**: Stores the core message, image metadata (S3 key, MIME, dimensions), scheduling details, and targeted audience rules.
- **`AnnouncementReadReceipt` Model**: Acts as a per-user delivery and view tracking record.
- **BullMQ Background Processor (`announcements-recipients.processor.ts`)**: When an admin clicks "Send to All", a background job fetches all matching active users and creates `AnnouncementReadReceipt` records in batches of 200. This ensures the admin UI remains snappy even for thousands of students.
- **Server-Sent Events (SSE)**: The `/api/v1/announcements/stream` endpoint notifies connected clients instantly when an announcement is published, triggering a refetch of pending announcements.
- **Idempotency**: `Send to All Users` sends an `Idempotency-Key` header and the backend stores the response for 24 hours, preventing duplicate publication records from double-clicks or retries.

### 2.2 Frontend Integration

- **`AppShell` (`app-shell.tsx`)**: Global component that polls for pending announcements immediately after authentication and renders the `AnnouncementModal` as an overlay.
- **Tracking Lifecycle**:
  1. `DISPLAYED`: Fired the moment the modal mounts.
  2. `VIEWED`: Fired after the image/content is loaded, the tab is active, and the viewer remains visible for 2 seconds.
  3. `ACKNOWLEDGED`: Fired if the announcement requires it and the user clicks "I Have Read This".
  4. `OPENED`: Fired when a user manually clicks an announcement from their history list (increments `openCount`).

### 2.3 Image Storage

Images are uploaded directly to S3 (MinIO) using pre-signed URLs.
1. Frontend requests a pre-signed URL via `POST /announcements/:id/image/presign`.
2. Frontend `PUT`s the file directly to the S3 bucket.
3. Frontend confirms upload via `POST /announcements/:id/image/complete`, which validates the file size and magic bytes before saving the metadata to the database.

## 3. Usage Instructions

### Creating an Announcement
1. Navigate to **Administration > Admin announcements**.
2. Click **New Announcement**.
3. Fill in title, message, and upload an image (max 10MB JPG/PNG/WebP).
4. Select category and priority.
5. Select audience (All College Users or Specific Role).
6. Enable **Auto-display popup on app open** to ensure high visibility.
7. Click **Send to All Users**.
8. Review the backend-calculated active recipient count in the confirmation dialog.
9. Click **Confirm and Send**.

### Viewing Analytics
1. Navigate to **Administration > Admin announcements**.
2. Click **View details** on any published announcement.
3. The dashboard shows the full funnel: Total > Delivered > Displayed > Viewed > Acknowledged.
4. The table below lists every recipient and their exact display, view, acknowledgement, open count, and last-opened timestamps.
5. Use search and delivery-status filters to find a recipient.
6. Use **Export CSV** to download recipient analytics. The export is permission-protected and written to the audit log.
