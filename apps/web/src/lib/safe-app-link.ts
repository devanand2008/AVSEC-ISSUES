export const notificationFallbackLink = "/notifications";

export function safeAppLink(value: unknown, origin: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return notificationFallbackLink;
  try {
    const base = new URL(origin);
    const target = new URL(value, base);
    if (target.origin !== base.origin || !["http:", "https:"].includes(target.protocol)) return notificationFallbackLink;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return notificationFallbackLink;
  }
}
