# Mobile LAN Access

Use this only for local campus/development testing on the same Wi-Fi. It is not a public production deployment method.

## Start

Run:

```powershell
.\START_AVS_APP.bat
```

The script checks Node.js, npm and Docker, detects the active local IPv4 address, starts web/API containers, and prints:

```text
Computer:
http://localhost:3000

Mobile devices on the same Wi-Fi:
http://YOUR-LAN-IP:3000
```

It also prints a QR code when the local `qrcode` package is available.

Phone camera access for `/scan-qr` requires HTTPS on most mobile browsers. The
plain LAN URL is still useful for non-camera pages, but QR scanner testing and
PWA installation require a trusted HTTPS address. Use the setup in
`CAMERA_HTTPS_SETUP.md`.

By default, the script uses the existing local `college-management-api:latest` and `college-management-web:latest` images for faster startup. To force a full Docker rebuild, run this before the BAT file:

```powershell
$env:AVS_REBUILD_IMAGES="1"
```

## Phone Steps

1. Connect the computer and phone to the same Wi-Fi.
2. Run `START_AVS_APP.bat`.
3. Open the displayed mobile URL on the phone.
4. If Windows Firewall asks, allow Docker/Node.js on private networks.
5. Keep the computer running while using the phone URL.
6. For QR scanning, open the HTTPS mobile URL from `CAMERA_HTTPS_SETUP.md`.

## Security Notes

- Only web/API are bound to `0.0.0.0` by the BAT file.
- PostgreSQL, Redis and MinIO remain bound to `127.0.0.1` in `docker-compose.yml`.
- Do not use this LAN setup as internet-facing production hosting.

## Latest Local LAN Test

Detected IP on 16 July 2026: `10.181.158.176`

Verified:

- `http://10.181.158.176:3000/login` returned 200.
- `http://10.181.158.176:4000/api/v1/health/live` returned 200.
- API CORS allowed `http://10.181.158.176:3000`.
- Browser login through the LAN URL called `http://10.181.158.176:4000/api/v1/auth/login`.
- PostgreSQL, Redis and MinIO stayed bound to localhost.

## Environment Variables

The BAT file sets:

```env
WEB_BIND_ADDRESS=0.0.0.0
API_BIND_ADDRESS=0.0.0.0
WEB_URL=http://LAN_IP:3000
NEXT_PUBLIC_API_URL=http://LAN_IP:4000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://LAN_IP:4000/realtime
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://LAN_IP:3000
```
