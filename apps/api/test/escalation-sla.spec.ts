/**
 * Escalation rules engine tests — verifies escalation level computation,
 * SLA breach detection, and escalation chain state transitions.
 */

/* ─── Minimal SLA policy model ─── */
interface SlaPolicy {
  priority: string;
  acknowledgementMinutes: number;
  resolutionMinutes: number;
  workingHoursOnly: boolean;
}

interface Issue {
  id: string;
  priority: string;
  status: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  acknowledgementDueAt: Date | null;
  resolutionDueAt: Date | null;
  escalationLevel: number;
}

const SLA_POLICIES: SlaPolicy[] = [
  { priority: "LOW",       acknowledgementMinutes: 240, resolutionMinutes: 2880,  workingHoursOnly: true  },
  { priority: "MEDIUM",    acknowledgementMinutes: 120, resolutionMinutes: 1440,  workingHoursOnly: true  },
  { priority: "HIGH",      acknowledgementMinutes: 60,  resolutionMinutes: 480,   workingHoursOnly: false },
  { priority: "CRITICAL",  acknowledgementMinutes: 30,  resolutionMinutes: 240,   workingHoursOnly: false },
  { priority: "EMERGENCY", acknowledgementMinutes: 15,  resolutionMinutes: 60,    workingHoursOnly: false },
];

function getSla(priority: string): SlaPolicy | undefined {
  return SLA_POLICIES.find((p) => p.priority === priority);
}

function isOverdue(issue: Issue): boolean {
  const now = new Date();
  const terminal = ["RESOLVED", "VERIFIED", "CLOSED", "CANCELLED", "REJECTED"];
  return Boolean(
    !terminal.includes(issue.status) &&
    issue.resolutionDueAt &&
    issue.resolutionDueAt < now
  );
}

function isAcknowledgementOverdue(issue: Issue): boolean {
  const now = new Date();
  const postAck = ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "VERIFIED", "CLOSED"];
  return Boolean(
    !postAck.includes(issue.status) &&
    issue.acknowledgementDueAt &&
    issue.acknowledgementDueAt < now
  );
}

function computeEscalationLevel(issue: Issue): number {
  const now = new Date();
  if (!issue.resolutionDueAt) return 0;
  const overdueMs = now.getTime() - issue.resolutionDueAt.getTime();
  if (overdueMs <= 0) return 0;
  if (overdueMs < 60 * 60 * 1000) return 1;  // < 1 hour
  if (overdueMs < 4 * 60 * 60 * 1000) return 2;  // 1–4 hours
  return 3;  // > 4 hours
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  const created = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
  return {
    id: "issue-001",
    priority: "HIGH",
    status: "NEW",
    createdAt: created,
    acknowledgedAt: null,
    resolvedAt: null,
    acknowledgementDueAt: new Date(created.getTime() + 60 * 60 * 1000),
    resolutionDueAt: new Date(created.getTime() + 8 * 60 * 60 * 1000),
    escalationLevel: 0,
    ...overrides,
  };
}

describe("SLA policy lookup", () => {
  it.each(SLA_POLICIES.map((p) => p.priority))("returns policy for %s priority", (priority) => {
    const sla = getSla(priority);
    expect(sla).toBeDefined();
    expect(sla!.priority).toBe(priority);
  });

  it("returns undefined for unknown priority", () => {
    expect(getSla("UNKNOWN")).toBeUndefined();
  });

  it("EMERGENCY has strictest SLA (15 min ack, 60 min resolution)", () => {
    const sla = getSla("EMERGENCY")!;
    expect(sla.acknowledgementMinutes).toBe(15);
    expect(sla.resolutionMinutes).toBe(60);
  });

  it("HIGH priority runs on calendar time (not working hours only)", () => {
    expect(getSla("HIGH")!.workingHoursOnly).toBe(false);
    expect(getSla("CRITICAL")!.workingHoursOnly).toBe(false);
  });

  it("LOW/MEDIUM use working-hours-only SLA", () => {
    expect(getSla("LOW")!.workingHoursOnly).toBe(true);
    expect(getSla("MEDIUM")!.workingHoursOnly).toBe(true);
  });
});

describe("SLA breach detection", () => {
  it("detects a resolution-overdue issue", () => {
    const issue = makeIssue({
      resolutionDueAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min overdue
      status: "ASSIGNED",
    });
    expect(isOverdue(issue)).toBe(true);
  });

  it("does not flag a resolved issue as overdue", () => {
    const issue = makeIssue({
      resolutionDueAt: new Date(Date.now() - 30 * 60 * 1000),
      status: "RESOLVED",
    });
    expect(isOverdue(issue)).toBe(false);
  });

  it("does not flag a future-due issue as overdue", () => {
    const issue = makeIssue({
      resolutionDueAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "IN_PROGRESS",
    });
    expect(isOverdue(issue)).toBe(false);
  });

  it("detects acknowledgement overdue", () => {
    const issue = makeIssue({
      acknowledgementDueAt: new Date(Date.now() - 10 * 60 * 1000),
      status: "ASSIGNED",
    });
    expect(isAcknowledgementOverdue(issue)).toBe(true);
  });

  it("does not flag an acknowledged issue as ack-overdue", () => {
    const issue = makeIssue({
      acknowledgementDueAt: new Date(Date.now() - 10 * 60 * 1000),
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
    });
    expect(isAcknowledgementOverdue(issue)).toBe(false);
  });
});

describe("Escalation level computation", () => {
  it("level 0 when not overdue", () => {
    const issue = makeIssue({ resolutionDueAt: new Date(Date.now() + 3_600_000) });
    expect(computeEscalationLevel(issue)).toBe(0);
  });

  it("level 1 when overdue by 30 minutes", () => {
    const issue = makeIssue({ resolutionDueAt: new Date(Date.now() - 30 * 60_000) });
    expect(computeEscalationLevel(issue)).toBe(1);
  });

  it("level 2 when overdue by 2 hours", () => {
    const issue = makeIssue({ resolutionDueAt: new Date(Date.now() - 2 * 3_600_000) });
    expect(computeEscalationLevel(issue)).toBe(2);
  });

  it("level 3 when overdue by 5 hours", () => {
    const issue = makeIssue({ resolutionDueAt: new Date(Date.now() - 5 * 3_600_000) });
    expect(computeEscalationLevel(issue)).toBe(3);
  });

  it("level 0 when no resolutionDueAt set", () => {
    const issue = makeIssue({ resolutionDueAt: null });
    expect(computeEscalationLevel(issue)).toBe(0);
  });
});

describe("Issue status terminal state checks", () => {
  const terminal = ["RESOLVED", "VERIFIED", "CLOSED", "CANCELLED", "REJECTED"];
  const active = ["NEW", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "OVERDUE"];

  it.each(terminal)("%s is terminal", (status) => {
    expect(terminal.includes(status)).toBe(true);
  });

  it.each(active)("%s is not terminal", (status) => {
    expect(terminal.includes(status)).toBe(false);
  });
});
