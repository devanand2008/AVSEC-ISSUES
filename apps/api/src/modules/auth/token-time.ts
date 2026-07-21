const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function durationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Unsupported token duration: ${value}`);
  const amount = Number(match[1]);
  const multiplier = UNITS[match[2] ?? ""];
  if (!multiplier) throw new Error(`Unsupported token duration: ${value}`);
  return amount * multiplier;
}
