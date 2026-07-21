# Issue Image Upload Guide

## Overview

When reporting an issue, users can optionally attach a photo to help the maintenance team understand the problem. This guide explains how the photo upload works on both mobile and desktop.

---

## How It Works

1. On **Step 5 (Photo)** of the issue reporting wizard:
   - Tap **Take Photo** to open the device camera directly (mobile only)
   - Tap **Choose from Gallery** to pick an existing photo
2. A preview appears immediately
3. Tap the preview image to enlarge it; tap again to shrink
4. Submit the issue form — the photo uploads **after** the issue is created

---

## Mobile Camera Support

The system uses the HTML `capture="environment"` attribute on the camera input. This means:
- On Android: opens the rear camera directly
- On iOS: shows a sheet to choose camera or gallery
- On desktop: opens the file browser (no camera)

The two buttons (**Take Photo** and **Choose from Gallery**) map to:
```html
<input type="file" capture="environment" accept="image/*" />  <!-- camera -->
<input type="file" accept="image/*" />                         <!-- gallery -->
```

---

## File Validation

The system performs **two layers of validation**:

### Layer 1: Client-side (before upload)
| Check | Rule |
|---|---|
| MIME type (declared) | Must be `image/jpeg`, `image/png`, or `image/webp` |
| MIME type (magic bytes) | First 12 bytes must match JPEG/PNG/WebP signature |
| File name | Must not contain special characters (`/`, `\`, `<`, `>`, `:`, `"`, `|`, `?`, `*`) |
| File size | Maximum 10 MB |
| Dimensions | At least 32×32 pixels |

### Layer 2: Server-side
| Check | Rule |
|---|---|
| File size | Maximum 10 MB |
| SHA-256 checksum | Verified after upload to detect corruption |
| Storage path | Must be within the authorised issue path |
| Purpose | Must be `ISSUE_REPORT` |

---

## Automatic Compression

If the selected image is **larger than 3 MB** or **wider/taller than 2200px**, the system automatically:
1. Scales it down to a maximum of 1800px on the longest side
2. Re-encodes it as JPEG at 82% quality
3. Only applies the compressed version if it is smaller than the original

This happens entirely in the browser — no original file data is sent to the server.

---

## Why Photo Upload is Optional

The issue is created and tracked regardless of whether a photo is attached. The upload step is completely independent:
- Issue creation may succeed even if the upload fails (a warning is shown)
- Issues without photos are treated identically to those with photos
- Photos can be added later via the issue detail page

---

## Supported Formats

| Format | Extension | Notes |
|---|---|---|
| JPEG | `.jpg`, `.jpeg` | Best for photos from a camera |
| PNG | `.png` | Good for screenshots |
| WebP | `.webp` | Modern format with smaller file size |

---

## Troubleshooting

| Error | Solution |
|---|---|
| "The photo type is not supported" | Use JPG, PNG or WebP only |
| "The file does not appear to be a valid image" | The file may be renamed; use a real photo |
| "The photo is larger than 10 MB" | Compress the photo first or take a new one |
| "The photo is too small" | Minimum 32×32 pixels |
| Upload fails after issue creation | The issue was still saved; you can attach the photo from the issue detail page |
