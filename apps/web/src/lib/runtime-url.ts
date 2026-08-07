const LOCAL_NAME_PATTERN = /^local(?:host)?$/i;

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const first = parts[0]!;
  const second = parts[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isDevelopmentHost(host: string): boolean {
  const ipv6 = host.replace(/^\[|\]$/g, "");
  return LOCAL_NAME_PATTERN.test(host) || ipv6 === "::1" || isPrivateIpv4(host);
}

function shouldUseCurrentHost(
  configuredHost: string,
  currentHost: string,
): boolean {
  if (configuredHost === currentHost) return false;
  return isDevelopmentHost(configuredHost) && isDevelopmentHost(currentHost);
}

export function resolveRuntimeUrl(
  configuredUrl: string,
  currentHostname?: string,
  currentOrigin?: string,
): string {
  const runtimeLocation =
    typeof window === "undefined" ? undefined : window.location;
  const currentHost = currentHostname ?? runtimeLocation?.hostname;
  const activeOrigin = currentOrigin ?? runtimeLocation?.origin;
  if (!currentHost) return configuredUrl;

  try {
    const url = new URL(configuredUrl);

    // A previously installed development build can retain a localhost/LAN API
    // URL after it is opened on the public Render host. Preserve only the API
    // path in that case so the PWA cannot attempt HTTP or port 4000 in
    // production. Public API and signed-storage hosts are never rewritten.
    if (
      isDevelopmentHost(url.hostname) &&
      !isDevelopmentHost(currentHost) &&
      activeOrigin
    ) {
      const origin = new URL(activeOrigin);
      origin.pathname = url.pathname;
      origin.search = url.search;
      origin.hash = url.hash;
      return origin.toString().replace(/\/$/, "");
    }

    if (shouldUseCurrentHost(url.hostname, currentHost)) {
      url.hostname = currentHost;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return configuredUrl;
  }
}
