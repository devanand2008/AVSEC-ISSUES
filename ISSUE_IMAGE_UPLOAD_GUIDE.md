# Issue Image Upload Guide

Issue reporting supports optional photos.

Required issue fields:

- Block
- Floor
- Room
- Issue category
- Common problem
- Description

Optional:

- Photo

Users may submit without a photo. The UI displays `Add Photo (Optional)` and allows phones to choose a camera photo or an existing gallery image.

Supported photo types:

- JPG/JPEG
- PNG
- WebP

Client validation blocks unsupported file types, unsafe filenames, corrupted images, very small images, and images over 10 MB. Large valid images are compressed in the browser before upload when compression reduces the file size.

Upload starts only after the issue is created. If upload fails, the issue remains created and the user sees a warning.
