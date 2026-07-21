const positive = new Set(["ACTIVE", "PRESENT", "VERIFIED", "CLOSED", "RESOLVED", "PUBLISHED", "SUBMITTED"]);
const warning = new Set(["PENDING", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR", "ON_HOLD", "DRAFT", "LATE"]);
const danger = new Set(["CRITICAL", "EMERGENCY", "OVERDUE", "REJECTED", "CANCELLED", "SUSPENDED", "DISABLED", "ABSENT", "NEEDS_MANUAL_ASSIGNMENT"]);

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toUpperCase();
  const className = statusBadgeClass(normalized);
  return <span className={className}>{normalized.replaceAll("_", " ")}</span>;
}

export function statusBadgeClass(value: string): string {
  const normalized = value.toUpperCase();
  return positive.has(normalized) ? "badge badge-green" : danger.has(normalized) ? "badge badge-red" : warning.has(normalized) ? "badge badge-orange" : "badge badge-blue";
}
