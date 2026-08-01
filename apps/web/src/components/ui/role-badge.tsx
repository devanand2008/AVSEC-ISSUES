"use client";

const roleStyles: Record<string, { bg: string; color: string }> = {
  SUPER_ADMIN: { bg: "var(--avs-error-surface)", color: "var(--avs-error-dark)" },
  MAIN_ADMIN: { bg: "var(--avs-error-surface)", color: "var(--avs-error-dark)" },
  PRINCIPAL: { bg: "var(--avs-secondary-surface)", color: "var(--avs-secondary-dark)" },
  VICE_PRINCIPAL: { bg: "var(--avs-secondary-surface)", color: "var(--avs-secondary-dark)" },
  HOD: { bg: "var(--avs-accent-surface)", color: "var(--avs-accent-dark)" },
  FACULTY: { bg: "var(--avs-info-surface)", color: "var(--avs-info)" },
  CLASS_COORDINATOR: { bg: "var(--avs-info-surface)", color: "var(--avs-info)" },
  CLASS_REPRESENTATIVE: { bg: "var(--avs-success-surface)", color: "var(--avs-success-dark)" },
  STUDENT: { bg: "var(--avs-primary-surface)", color: "var(--avs-primary)" },
  MAINTENANCE_ADMIN: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
  MAINTENANCE_SUPERVISOR: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
  MAINTENANCE_STAFF: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
  ELECTRICIAN: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
  PLUMBER: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
  IT_SUPPORT: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)" },
};

const defaultStyle = { bg: "var(--avs-page-alt)", color: "var(--avs-text-muted)" };

function formatRole(code: string): string {
  return code.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

interface RoleBadgeProps {
  code: string;
  name?: string;
}

export function RoleBadge({ code, name }: RoleBadgeProps) {
  const style = roleStyles[code] ?? defaultStyle;
  return (
    <span
      className="avs-badge"
      style={{ background: style.bg, color: style.color }}
    >
      {name ?? formatRole(code)}
    </span>
  );
}
