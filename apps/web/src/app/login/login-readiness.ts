export type LoginReadiness = "offline" | "ready" | "unavailable";

interface ReadinessOptions {
  attempts?: number;
  delaysMs?: readonly number[];
  isOnline?: () => boolean;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export async function probeLoginReadiness(
  ping: () => Promise<void>,
  {
    attempts = 3,
    delaysMs = [1_000, 2_500],
    isOnline = () => typeof navigator === "undefined" || navigator.onLine,
    wait = defaultWait,
  }: ReadinessOptions = {},
): Promise<LoginReadiness> {
  const boundedAttempts = Math.max(1, Math.min(attempts, 3));
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    if (!isOnline()) return "offline";
    try {
      await ping();
      return "ready";
    } catch {
      if (attempt + 1 < boundedAttempts) {
        await wait(delaysMs[attempt] ?? delaysMs.at(-1) ?? 0);
      }
    }
  }
  return isOnline() ? "unavailable" : "offline";
}
