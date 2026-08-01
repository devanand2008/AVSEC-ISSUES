"use client";

import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: string; positive?: boolean };
  onClick?: () => void;
}

export function StatCard({ label, value, icon, iconBg, iconColor, trend, onClick }: StatCardProps) {
  return (
    <div
      className="avs-stat-card"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="avs-stat-card-label">{label}</span>
        {icon && (
          <div
            className="avs-stat-card-icon"
            style={{
              background: iconBg ?? "var(--avs-primary-surface)",
              color: iconColor ?? "var(--avs-primary)",
            }}
          >
            {icon}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
        <span className="avs-stat-card-value">{value}</span>
        {trend && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)" as unknown as number,
              color: trend.positive ? "var(--avs-success)" : "var(--avs-error)",
            }}
          >
            {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
