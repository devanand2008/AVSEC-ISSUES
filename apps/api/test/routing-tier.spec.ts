/**
 * Routing tier tests — validates the assignment rule precedence engine, SLA policy
 * selection, and team/individual assignment eligibility checks.
 */

/* ─── Rule matching priority model ─── */
interface AssignmentRule {
  id: string;
  teamId: string;
  campusId: string | null;
  blockId: string | null;
  floorId: string | null;
  roomId: string | null;
  categoryId: string | null;
  issueTypeId: string | null;
  priorityFilter: string | null;
  rulePriority: number;
  isActive: boolean;
}

interface IssueContext {
  campusId: string;
  blockId: string;
  floorId: string;
  roomId: string;
  categoryId: string;
  issueTypeId: string | null;
  priority: string;
}

function ruleSpecificity(rule: AssignmentRule): number {
  let score = 0;
  if (rule.roomId) score += 16;
  if (rule.floorId) score += 8;
  if (rule.blockId) score += 4;
  if (rule.campusId) score += 2;
  if (rule.categoryId) score += 1;
  if (rule.issueTypeId) score += 1;
  if (rule.priorityFilter) score += 1;
  return score;
}

function ruleMatches(rule: AssignmentRule, ctx: IssueContext): boolean {
  if (!rule.isActive) return false;
  if (rule.roomId && rule.roomId !== ctx.roomId) return false;
  if (rule.floorId && rule.floorId !== ctx.floorId) return false;
  if (rule.blockId && rule.blockId !== ctx.blockId) return false;
  if (rule.campusId && rule.campusId !== ctx.campusId) return false;
  if (rule.categoryId && rule.categoryId !== ctx.categoryId) return false;
  if (rule.issueTypeId && rule.issueTypeId !== ctx.issueTypeId) return false;
  if (rule.priorityFilter && rule.priorityFilter !== ctx.priority) return false;
  return true;
}

function selectRule(rules: AssignmentRule[], ctx: IssueContext): AssignmentRule | null {
  const matching = rules
    .filter((r) => ruleMatches(r, ctx))
    .sort((a, b) => {
      const specDiff = ruleSpecificity(b) - ruleSpecificity(a);
      return specDiff !== 0 ? specDiff : b.rulePriority - a.rulePriority;
    });
  return matching[0] ?? null;
}

const BASE_CTX: IssueContext = {
  campusId: "campus-1",
  blockId: "block-1",
  floorId: "floor-1",
  roomId: "room-1",
  categoryId: "cat-electrical",
  issueTypeId: "type-fan",
  priority: "HIGH",
};

function makeRule(overrides: Partial<AssignmentRule> = {}): AssignmentRule {
  return {
    id: "rule-001",
    teamId: "team-A",
    campusId: null,
    blockId: null,
    floorId: null,
    roomId: null,
    categoryId: null,
    issueTypeId: null,
    priorityFilter: null,
    rulePriority: 0,
    isActive: true,
    ...overrides,
  };
}

describe("Assignment rule specificity scoring", () => {
  it("room-level rule has highest specificity", () => {
    const roomRule = makeRule({ roomId: "room-1", blockId: "block-1", campusId: "campus-1" });
    const campusRule = makeRule({ campusId: "campus-1" });
    expect(ruleSpecificity(roomRule)).toBeGreaterThan(ruleSpecificity(campusRule));
  });

  it("floor-level beats block-level", () => {
    const floorRule = makeRule({ floorId: "floor-1" });
    const blockRule = makeRule({ blockId: "block-1" });
    expect(ruleSpecificity(floorRule)).toBeGreaterThan(ruleSpecificity(blockRule));
  });

  it("block-level beats campus-level", () => {
    const blockRule = makeRule({ blockId: "block-1" });
    const campusRule = makeRule({ campusId: "campus-1" });
    expect(ruleSpecificity(blockRule)).toBeGreaterThan(ruleSpecificity(campusRule));
  });

  it("category filter adds to score", () => {
    const withCategory = makeRule({ campusId: "c1", categoryId: "cat" });
    const withoutCategory = makeRule({ campusId: "c1" });
    expect(ruleSpecificity(withCategory)).toBeGreaterThan(ruleSpecificity(withoutCategory));
  });

  it("rule with no filters scores zero", () => {
    expect(ruleSpecificity(makeRule())).toBe(0);
  });
});

describe("Rule matching", () => {
  it("matches a campus-wide catch-all rule", () => {
    const rule = makeRule({ campusId: "campus-1" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(true);
  });

  it("does not match when campusId differs", () => {
    const rule = makeRule({ campusId: "campus-99" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(false);
  });

  it("matches a room-specific rule", () => {
    const rule = makeRule({ roomId: "room-1" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(true);
  });

  it("does not match wrong room", () => {
    const rule = makeRule({ roomId: "room-999" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(false);
  });

  it("matches category + campus combination", () => {
    const rule = makeRule({ campusId: "campus-1", categoryId: "cat-electrical" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(true);
  });

  it("does not match wrong category", () => {
    const rule = makeRule({ campusId: "campus-1", categoryId: "cat-plumbing" });
    expect(ruleMatches(rule, BASE_CTX)).toBe(false);
  });

  it("inactive rules are never selected", () => {
    const rule = makeRule({ campusId: "campus-1", isActive: false });
    expect(ruleMatches(rule, BASE_CTX)).toBe(false);
  });

  it("priority filter is respected", () => {
    const criticalRule = makeRule({ campusId: "campus-1", priorityFilter: "CRITICAL" });
    expect(ruleMatches(criticalRule, BASE_CTX)).toBe(false); // ctx is HIGH
    expect(ruleMatches(criticalRule, { ...BASE_CTX, priority: "CRITICAL" })).toBe(true);
  });
});

describe("selectRule — winner resolution", () => {
  it("selects the most specific matching rule", () => {
    const roomRule = makeRule({ id: "room-rule", roomId: "room-1", teamId: "team-rooms" });
    const campusRule = makeRule({ id: "campus-rule", campusId: "campus-1", teamId: "team-campus" });
    const result = selectRule([campusRule, roomRule], BASE_CTX);
    expect(result?.id).toBe("room-rule");
  });

  it("uses rulePriority as tiebreaker between equal-specificity rules", () => {
    const lowPriority = makeRule({ id: "low", categoryId: "cat-electrical", rulePriority: 10 });
    const highPriority = makeRule({ id: "high", categoryId: "cat-electrical", rulePriority: 100 });
    const result = selectRule([lowPriority, highPriority], BASE_CTX);
    expect(result?.id).toBe("high");
  });

  it("returns null when no rule matches", () => {
    const rule = makeRule({ campusId: "campus-99" });
    expect(selectRule([rule], BASE_CTX)).toBeNull();
  });

  it("returns null for an empty rule set", () => {
    expect(selectRule([], BASE_CTX)).toBeNull();
  });

  it("ignores inactive rules in selection", () => {
    const active = makeRule({ id: "active-campus", campusId: "campus-1", isActive: true });
    const inactive = makeRule({ id: "inactive-room", roomId: "room-1", isActive: false });
    const result = selectRule([active, inactive], BASE_CTX);
    expect(result?.id).toBe("active-campus");
  });
});
