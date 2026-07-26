# Camera and HTTPS Setup

Mobile browsers only allow camera access from a secure context. Desktop `localhost`
usually works over HTTP, but a phone opening `http://<computer-ip>:3000` may block
`navigator.mediaDevices.getUserMedia()` and QR scanning.

## Supported Test URLs

- Desktop on the same machine: `http://localhost:3000`
- Android emulator mapped to host: `http://10.0.2.2:3000`
- Phone on Wi-Fi: use HTTPS whenever camera access is required

`START_AVS_APP.bat` still prints the plain LAN URL because it works for pages
that do not need the camera. For QR scanning from a phone, put HTTPS in front of
the web app.

## Option 1: Local HTTPS Proxy With mkcert

1. Install mkcert from `https://github.com/FiloSottile/mkcert`.
2. Trust the local certificate authority:

```powershell
mkcert -install
```

3. Create a certificate for your development host names and LAN IP:

```powershell
mkcert localhost 127.0.0.1 192.168.1.25
```

Replace `192.168.1.25` with the LAN IP printed by `START_AVS_APP.bat`.

4. Run local HTTPS reverse proxies that forward both browser-facing services:

```text
https://<lan-ip>:3443 -> http://localhost:3000
https://<lan-ip>:4443 -> http://localhost:4000
```

5. Set the app URLs to the HTTPS address before starting the stack:

```powershell
$env:WEB_URL="https://192.168.1.25:3443"
$env:MOBILE_URL="https://192.168.1.25:3443"
$env:NEXT_PUBLIC_API_URL="https://192.168.1.25:4443/api/v1"
$env:NEXT_PUBLIC_SOCKET_URL="https://192.168.1.25:4443/realtime"
$env:CORS_ALLOWED_ORIGINS="https://192.168.1.25:3443,http://localhost:3000,http://127.0.0.1:3000"
```

6. Install or trust the mkcert root certificate on the phone. Android Chrome and
iOS Safari will not treat the page as secure until the certificate is trusted.

## Option 2: Temporary HTTPS Tunnel

Use a trusted tunnel when installing a local certificate on phones is not
practical:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Set `WEB_URL`, `MOBILE_URL` and `CORS_ALLOWED_ORIGINS` to the generated HTTPS
tunnel origin. Also set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` to
HTTPS API and realtime origins that the phone browser can reach, then restart
the API and web services.

## QR Scanner Checklist

- Open `/scan-qr` from the phone.
- Use HTTPS or desktop `localhost`.
- Allow camera permission when prompted.
- Prefer the rear camera in the camera selector.
- If the camera is blocked, use the image upload or manual token fallback.
- Room QR codes route to `/report-issue` with the scanned room locked.
- Feedback QR codes route to the secure feedback target page.

## Security Notes

- The general validator rejects external QR URLs.
- Only approved AVS paths and token formats are accepted.
- Feedback QR tokens are hashed in storage and never exposed from the database.
- Room QR issue submissions store `submissionSource=QR_SCAN` and the scanned
  room id for analytics.
