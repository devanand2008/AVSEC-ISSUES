# Camera and HTTPS Setup

Mobile browsers only allow camera access from a secure context. Desktop
`localhost` usually works over HTTP, but a phone opening
`http://<computer-ip>:3000` may block camera access and QR scanning.

Use HTTPS for phone testing. A local trusted certificate with mkcert or a
temporary HTTPS tunnel such as cloudflared both work. The web URL and the
browser-facing API/socket URLs must all be HTTPS to avoid mixed-content blocks.

Quick checklist:

- Open `/scan-qr` from the phone.
- Use HTTPS or desktop `localhost`.
- Allow camera permission when prompted.
- Prefer the rear camera in the camera selector.
- Use image upload or manual token entry if camera access is blocked.
- Room QR codes route to `/report-issue` with the scanned room locked.
- Feedback QR codes route to the secure feedback target page.

See `CAMERA_AND_HTTPS_SETUP.md` in the repository root for full setup commands.
