const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const first = parts[0]!;
  const second = parts[1]!;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isDevelopmentHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || isPrivateIpv4(host);
}

function shouldUseCurrentHost(configuredHost: string, currentHost: string): boolean {
  if (configuredHost === currentHost) return false;
  if (LOCAL_HOSTS.has(configuredHost) && !LOCAL_HOSTS.has(currentHost)) return true;
  return isDevelopmentHost(configuredHost) && isDevelopmentHost(currentHost);
}

export function resolveRuntimeUrl(configuredUrl: string, currentHostname?: string): string {
  const currentHost = currentHostname ?? (typeof window === "undefined" ? undefined : window.location.hostname);
  if (!currentHost) return configuredUrl;

  try {
    const url = new URL(configuredUrl);

    if (shouldUseCurrentHost(url.hostname, currentHost)) {
      url.hostname = currentHost;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return configuredUrl;
  }
}
