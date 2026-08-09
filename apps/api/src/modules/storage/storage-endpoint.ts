import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";

const LOCAL_MINIO_HOSTNAMES = new Set([
  "minio",
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);

export function publicStorageEndpoint(
  request: Pick<Request, "protocol" | "hostname">,
  config: ConfigService,
): string | undefined {
  return requestHostMinioEndpoint(
    request,
    config.get<string>("S3_ENDPOINT"),
    config.get<string>("MINIO_API_HOST_PORT", "9000"),
  );
}

/**
 * Returns a browser-reachable MinIO endpoint when S3 is configured on a local
 * Docker/loopback host. Remote S3-compatible endpoints must be signed using
 * their configured endpoint instead.
 */
export function requestHostMinioEndpoint(
  request: Pick<Request, "protocol" | "hostname">,
  configuredEndpoint: string | undefined,
  publicPort = "9000",
): string | undefined {
  const configuredHostname = parseHostname(configuredEndpoint);
  if (
    !configuredHostname ||
    !LOCAL_MINIO_HOSTNAMES.has(configuredHostname)
  ) {
    return undefined;
  }

  const requestHostname = normalizeHostname(request.hostname);
  if (!requestHostname) return undefined;

  const port = validPort(publicPort) ? publicPort : "9000";
  const urlHostname = requestHostname.includes(":")
    ? `[${requestHostname}]`
    : requestHostname;

  try {
    return new URL(`${request.protocol}://${urlHostname}:${port}`).origin;
  } catch {
    return undefined;
  }
}

function parseHostname(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;

  try {
    return normalizeHostname(new URL(endpoint).hostname);
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string | undefined {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return normalized || undefined;
}

function validPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) return false;
  const numericPort = Number(port);
  return numericPort >= 1 && numericPort <= 65_535;
}
