export interface BooleanRefLike {
  current: boolean;
}

export interface CameraAccessGuidance {
  title: string;
  message: string;
}

export function extractFeedbackToken(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).pathname.split("/").filter(Boolean).pop() ?? "";
    }
  } catch {
    return value;
  }
  return value;
}

export function acquireDecodeLock(lock: BooleanRefLike): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function resetDecodeLock(lock: BooleanRefLike): void {
  lock.current = false;
}

export function cameraAccessGuidance(
  caught: unknown,
  secureContext: boolean,
): CameraAccessGuidance {
  if (!secureContext) {
    return {
      title: "A secure connection is required",
      message:
        "Open this page over HTTPS, or use localhost during development, then try the camera again.",
    };
  }

  const detail =
    caught instanceof Error
      ? `${caught.name} ${caught.message}`.toLowerCase()
      : String(caught).toLowerCase();
  if (/notallowed|permission|denied|security/.test(detail)) {
    return {
      title: "Camera access is blocked",
      message:
        "Use the site controls beside the address bar to allow camera access, then select Try again. You can still enter the QR code manually below.",
    };
  }
  if (/notfound|no camera|devicesnotfound|overconstrained/.test(detail)) {
    return {
      title: "No usable camera was found",
      message:
        "Connect or enable a camera, close other apps using it, and try again. Manual code entry remains available.",
    };
  }
  return {
    title: "The camera could not start",
    message:
      "Check the browser camera permission, close other apps using the camera, and try again. Manual code entry remains available.",
  };
}

export function safeFeedbackPhotoSource(
  value: string | null | undefined,
  origin?: string,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//"))
    return candidate;
  if (!origin) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.origin === origin &&
      ["http:", "https:"].includes(parsed.protocol)
      ? `${parsed.pathname}${parsed.search}`
      : null;
  } catch {
    return null;
  }
}
