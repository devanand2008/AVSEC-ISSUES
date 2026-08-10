import type { NextConfig } from "next";

function origin(value: string | undefined): string | undefined {
  if (!value || value.startsWith("/")) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function developmentWildcardOrigin(
  value: string | undefined,
): string | undefined {
  if (!value || value.startsWith("/")) return undefined;
  try {
    const url = new URL(value);
    const privateHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0" ||
      url.hostname.startsWith("10.") ||
      url.hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
    if (!privateHost) return undefined;
    return `${url.protocol}//*${url.port ? `:${url.port}` : ""}`;
  } catch {
    return undefined;
  }
}

function websocketOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("https://")) return value.replace("https://", "wss://");
  if (value.startsWith("http://")) return value.replace("http://", "ws://");
  return undefined;
}

const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.VITE_API_BASE_URL ?? "/api/v1";
const configuredSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "/realtime";

const apiOrigin = origin(configuredApiUrl);
const socketOrigin = origin(configuredSocketUrl);
const lanApiOrigin = developmentWildcardOrigin(configuredApiUrl);
const lanSocketOrigin = developmentWildcardOrigin(configuredSocketUrl);
const socketPeerOrigin = socketOrigin?.startsWith("https://")
  ? socketOrigin.replace("https://", "wss://")
  : socketOrigin?.startsWith("http://")
    ? socketOrigin.replace("http://", "ws://")
    : socketOrigin?.startsWith("wss://")
      ? socketOrigin.replace("wss://", "https://")
      : socketOrigin?.startsWith("ws://")
        ? socketOrigin.replace("ws://", "http://")
        : undefined;
const storageOrigin = origin(
  process.env.NEXT_PUBLIC_OBJECT_STORAGE_ORIGIN ??
    process.env.S3_PUBLIC_ENDPOINT ??
    process.env.S3_ENDPOINT,
);
const imageSources = [
  "'self'",
  "data:",
  "blob:",
  "https://*.storage.supabase.co",
  storageOrigin,
]
  .filter((value): value is string => Boolean(value))
  .join(" ");
const buildCpus = Number(process.env.NEXT_BUILD_CPUS ?? "");
const connectSources = [
  ...new Set(
    [
      "'self'",
      apiOrigin,
      lanApiOrigin,
      socketOrigin,
      lanSocketOrigin,
      socketPeerOrigin,
      websocketOrigin(lanSocketOrigin),
      storageOrigin,
      ...(process.env.NODE_ENV === "production"
        ? []
        : ["http://localhost:9000", "http://127.0.0.1:9000"]),
      "https:",
    ].filter((value): value is string => Boolean(value)),
  ),
].join(" ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self)",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""} https://www.gstatic.com`,
      "style-src 'self' 'unsafe-inline'",
      `img-src ${imageSources}`,
      "font-src 'self'",
      `connect-src ${connectSources}`,
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  ...(Number.isInteger(buildCpus) && buildCpus > 0
    ? { experimental: { cpus: buildCpus } }
    : {}),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/login",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
