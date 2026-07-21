import { ConfigService } from "@nestjs/config";

export function parseAllowedOrigins(
  allowedOrigins?: string,
  webUrl = "http://localhost:3000",
): string[] {
  return (allowedOrigins ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .concat(webUrl)
    .filter((origin, index, origins) => origins.indexOf(origin) === index);
}

function isPrivateHost(hostname: string): boolean {
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname))
    return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  const match = /^172\.(\d+)\./.exec(hostname);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

export function isAllowedOrigin(
  origin: string,
  allowedOrigins: string[],
  webUrl: string,
): boolean {
  if (allowedOrigins.includes(origin)) return true;
  try {
    const candidate = new URL(origin);
    const configured = new URL(webUrl);
    return (
      isPrivateHost(configured.hostname) &&
      isPrivateHost(candidate.hostname) &&
      candidate.protocol === configured.protocol &&
      effectivePort(candidate) === effectivePort(configured)
    );
  } catch {
    return false;
  }
}

export function allowedOriginsFromConfig(config: ConfigService): string[] {
  return parseAllowedOrigins(
    config.get<string>("CORS_ALLOWED_ORIGINS"),
    config.getOrThrow<string>("WEB_URL"),
  );
}

export function isAllowedOriginFromConfig(
  config: ConfigService,
  origin: string,
): boolean {
  const webUrl = config.getOrThrow<string>("WEB_URL");
  return isAllowedOrigin(origin, allowedOriginsFromConfig(config), webUrl);
}
