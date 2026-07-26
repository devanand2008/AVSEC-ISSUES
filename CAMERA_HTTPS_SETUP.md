# Camera HTTPS Setup

This project keeps the full mobile camera setup guide in
`CAMERA_AND_HTTPS_SETUP.md`.

Use HTTPS for phone-based QR scanning. Desktop `localhost` usually qualifies as
a secure context, but `http://LAN-IP:3000` on a phone commonly blocks camera
access. `START_AVS_APP.bat` prints the LAN HTTP URL for normal mobile testing;
use the HTTPS reverse proxy or tunnel steps in `CAMERA_AND_HTTPS_SETUP.md` when
testing `/scan-qr` with a real phone camera.
