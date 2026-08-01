"use client";

interface LoadingSkeletonProps {
  variant?: "text" | "card" | "table-row" | "avatar" | "stat";
  lines?: number;
  width?: string;
}

export function LoadingSkeleton({ variant = "text", lines = 3, width }: LoadingSkeletonProps) {
  if (variant === "avatar") {
    return <div className="avs-skeleton avs-skeleton-avatar" />;
  }
  if (variant === "card") {
    return <div className="avs-skeleton avs-skeleton-card" style={{ width }} />;
  }
  if (variant === "stat") {
    return (
      <div className="avs-stat-card" style={{ gap: "var(--space-3)" }}>
        <div className="avs-skeleton avs-skeleton-text" style={{ width: "60%" }} />
        <div className="avs-skeleton avs-skeleton-text" style={{ width: "40%", height: 28 }} />
      </div>
    );
  }
  if (variant === "table-row") {
    return (
      <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-3) var(--space-4)", alignItems: "center" }}>
        <div className="avs-skeleton avs-skeleton-avatar" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div className="avs-skeleton avs-skeleton-text" style={{ width: "70%" }} />
          <div className="avs-skeleton avs-skeleton-text" style={{ width: "40%" }} />
        </div>
        <div className="avs-skeleton avs-skeleton-text" style={{ width: 60 }} />
        <div className="avs-skeleton avs-skeleton-text" style={{ width: 80 }} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="avs-skeleton avs-skeleton-text" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

/** Full-page loading skeleton for People list */
export function PeopleListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {Array.from({ length: count }).map((_, i) => (
        <LoadingSkeleton key={i} variant="table-row" />
      ))}
    </div>
  );
}
