# QR Camera Guide

## User Flow

- Open `/scan-qr`.
- Tap **Allow camera** to start live scanning.
- Use rear camera selection when available.
- Switch cameras or flashlight when supported by the browser.
- Upload a QR image or enter the QR token manually when camera access is blocked.

## Supported QR Types

- Room QR for issue reporting.
- Feedback QR for staff/target feedback.

The backend endpoint is:

```text
POST /api/v1/qr/validate
```

The validator accepts only official AVS token formats and approved AVS paths. It
rejects external URLs and checks the current user's permission before returning a
destination.

## Room QR

Room QR validation opens:

```text
/report-issue?roomToken=<secure-token>&source=qr
```

The report form loads the room hierarchy, locks campus/block/floor/room selection
and submits the issue with `submissionSource=QR_SCAN`.

## Admin

Use `/admin/qr-management` for:

- General scanner access.
- Room QR sheet entry.
- Feedback QR management.
- Scan and submission analytics.
- Audit navigation.

## Mobile HTTPS

Phone camera access requires HTTPS in most browsers. See
`CAMERA_HTTPS_SETUP.md`.
