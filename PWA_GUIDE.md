# PWA Guide

## Configuration

- Manifest: `apps/web/public/manifest.webmanifest`
- Service worker: `apps/web/public/sw.js`
- Offline page: `/offline`
- App name: `AVS College Management`
- Short name: `AVS CMS`
- Theme color: `#0B3D91`
- Icons: `apps/web/public/icons`

## Install

1. Start the app with `START_AVS_APP.bat`.
2. Open the site in Chrome, Edge, or Safari.
3. Select the visible **Install app** button.
4. Accept the browser prompt. On iPhone/iPad, use Safari's Share menu and
   select **Add to Home Screen**.

PWA installation requires a secure browser context:

- `http://localhost:3000` is treated as secure for desktop development.
- A deployed `https://` site can be installed normally.
- A phone URL such as `http://LAN-IP:3000` is not installable, even though the
  site itself opens. The install button explains this limitation. Use the
  trusted HTTPS setup in `CAMERA_AND_HTTPS_SETUP.md` for phone installation.

The launcher does not require a browser-specific PWA app id. The browser version
always remains available.

## Cache Policy

The service worker must not cache passwords, private API responses, private
attachments or confidential exports. Treat authenticated API responses as
network-first or no-store unless explicitly reviewed.

## Mobile Notes

Use the LAN URL for normal mobile testing. Use HTTPS for phone camera scanning;
see `CAMERA_HTTPS_SETUP.md`.
