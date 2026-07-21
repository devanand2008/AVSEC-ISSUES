/**
 * Analytics / reports utility tests — verifies the in-memory time-series
 * bucketing logic, SLA compliance calculations, and breakdown helpers
 * used by ReportsService.
 */

/* ─── Shared helpers mirroring ReportsService logic ─── */
function dailyBuckets(days: number): Map<string, { date: string; created: number; resolved: number; overdue: number }> {
  const since = new Date(Date.now() - days * 86400_000);
  const map = new Map<string, { date: string; created: number; resolved: number; overdue: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, created: 0, resolved: 0, overdue: 0 });
  }
  return map;
}

function computeCompliance(issues: Array<{ resolvedAt: Date; resolutionDueAt: Date }>): number | null {
  if (!issues.length) return null;
  const compliant = issues.filter((i) => i.resolvedAt <= i.resolutionDueAt).length;
  return Math.round(compliant / issues.length * 10_000) / 100;
}

function breakdown(values: Array<string | null | undefined>): Array<{ name: string; count: number }> {
  return [...values.reduce((map, value) => {
    const key = value || "Unspecified";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>())]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function averageMinutes(pairs: Array<[Date, Date]>): number | null {
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, [start, end]) => sum + (end.getTime() - start.getTime()), 0);
  return Math.round(total / pairs.length / 60_000);
}

describe("Daily bucket initialisation", () => {
  it("creates exactly N buckets for N days", () => {
    expect(dailyBuckets(7).size).toBe(7);
    expect(dailyBuckets(30).size).toBe(30);
    expect(dailyBuckets(90).size).toBe(90);
  });

  it("all initial buckets have zero counts", () => {
    const buckets = dailyBuckets(14);
    for (const bucket of buckets.values()) {
      expect(bucket.created).toBe(0);
      expect(bucket.resolved).toBe(0);
      expect(bucket.overdue).toBe(0);
    }
  });

  it("bucket keys are ISO date strings (YYYY-MM-DD)", () => {
    const buckets = dailyBuckets(5);
    for (const key of buckets.keys()) {
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("buckets are in chronological order", () => {
    const keys = [...dailyBuckets(7).keys()];
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
  });
});

describe("SLA compliance calculation", () => {
  it("returns null for empty set", () => {
    expect(computeCompliance([])).toBeNull();
  });

  it("returns 100% when all issues are within SLA", () => {
    const now = new Date();
    const issues = [
      { resolvedAt: new Date(now.getTime() - 1000), resolutionDueAt: now },
      { resolvedAt: new Date(now.getTime() - 5000), resolutionDueAt: now },
    ];
    expect(computeCompliance(issues)).toBe(100);
  });

  it("returns 0% when all issues breached SLA", () => {
    const now = new Date();
    const issues = [
      { resolvedAt: new Date(now.getTime() + 1000), resolutionDueAt: now },
      { resolvedAt: new Date(now.getTime() + 5000), resolutionDueAt: now },
    ];
    expect(computeCompliance(issues)).toBe(0);
  });

  it("returns 50% for half-compliant set", () => {
    const now = new Date();
    const issues = [
      { resolvedAt: new Date(now.getTime() - 1000), resolutionDueAt: now },  // compliant
      { resolvedAt: new Date(now.getTime() + 1000), resolutionDueAt: now },  // breached
    ];
    expect(computeCompliance(issues)).toBe(50);
  });

  it("rounds to 2 decimal places", () => {
    const now = new Date();
    // 2 of 3 compliant = 66.67%
    const issues = [
      { resolvedAt: new Date(now.getTime() - 1000), resolutionDueAt: now },
      { resolvedAt: new Date(now.getTime() - 2000), resolutionDueAt: now },
      { resolvedAt: new Date(now.getTime() + 1000), resolutionDueAt: now },
    ];
    expect(computeCompliance(issues)).toBeCloseTo(66.67, 1);
  });
});

describe("Breakdown helper", () => {
  it("counts values correctly", () => {
    const result = breakdown(["A", "B", "A", "A", "C"]);
    expect(result).toEqual([
      { name: "A", count: 3 },
      { name: "B", count: 1 },
      { name: "C", count: 1 },
    ]);
  });

  it("sorts by descending count", () => {
    const result = breakdown(["X", "Y", "Y", "Y", "X", "X", "X"]);
    expect(result.at(0)).toEqual({ name: "X", count: 4 });
  });

  it("groups null and undefined as 'Unspecified'", () => {
    const result = breakdown([null, undefined, null, "A"]);
    const unspecified = result.find((r) => r.name === "Unspecified");
    expect(unspecified?.count).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(breakdown([])).toEqual([]);
  });

  it("handles single unique value", () => {
    const result = breakdown(["A", "A", "A"]);
    expect(result).toEqual([{ name: "A", count: 3 }]);
  });
});

describe("Average minutes computation", () => {
  it("returns null for empty pair set", () => {
    expect(averageMinutes([])).toBeNull();
  });

  it("computes average of a single pair", () => {
    const start = new Date(Date.now() - 60_000);
    const end = new Date();
    expect(averageMinutes([[start, end]])).toBe(1);
  });

  it("computes average across multiple pairs", () => {
    const now = new Date();
    const pairs: [Date, Date][] = [
      [new Date(now.getTime() - 60_000), now],     // 1 min
      [new Date(now.getTime() - 120_000), now],    // 2 min
    ];
    expect(averageMinutes(pairs)).toBe(2); // (1+2)/2 = 1.5 → rounds to 2
  });

  it("rounds to nearest minute", () => {
    const now = new Date();
    // 90 seconds → 1.5 minutes → rounds to 2
    const pairs: [Date, Date][] = [
      [new Date(now.getTime() - 90_000), now],
    ];
    expect(averageMinutes(pairs)).toBe(2);
  });
});
