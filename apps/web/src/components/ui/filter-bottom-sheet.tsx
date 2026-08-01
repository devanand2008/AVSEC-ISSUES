"use client";

import { Filter, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

interface FilterBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  activeCount?: number;
}

export function FilterBottomSheet({ open, onClose, title = "Filters", children, onApply, onReset, activeCount = 0 }: FilterBottomSheetProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!open) return null;

  /* Mobile: bottom sheet */
  if (isMobile) {
    return (
      <>
        <div className="avs-bottom-sheet-backdrop" onClick={onClose} />
        <div className="avs-bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
          <div className="avs-bottom-sheet-handle" />
          <div className="avs-bottom-sheet-header">
            <h3>{title} {activeCount > 0 && <span className="avs-badge avs-badge-primary">{activeCount}</span>}</h3>
            <button className="avs-btn avs-btn-ghost avs-btn-icon" onClick={onClose} aria-label="Close" type="button">
              <X size={16} />
            </button>
          </div>
          <div className="avs-bottom-sheet-body">
            {children}
          </div>
          <div style={{ padding: "var(--space-3) var(--space-4)", display: "flex", gap: "var(--space-3)", borderTop: "1px solid var(--avs-border-light)" }}>
            {onReset && (
              <button className="avs-btn avs-btn-ghost" onClick={onReset} type="button" style={{ flex: 1 }}>
                Reset
              </button>
            )}
            <button className="avs-btn avs-btn-primary" onClick={() => { onApply?.(); onClose(); }} type="button" style={{ flex: 2 }}>
              Apply Filters
            </button>
          </div>
        </div>
      </>
    );
  }

  /* Desktop: inline panel */
  return (
    <div className="avs-card-flat" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Filter size={14} style={{ color: "var(--avs-text-muted)" }} />
          <span className="heading-5">{title}</span>
          {activeCount > 0 && <span className="avs-badge avs-badge-primary">{activeCount}</span>}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {onReset && <button className="avs-btn avs-btn-ghost avs-btn-sm" onClick={onReset} type="button">Reset</button>}
          <button className="avs-btn avs-btn-ghost avs-btn-sm" onClick={onClose} aria-label="Close filters" type="button">
            <X size={14} />
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-3)" }}>
        {children}
      </div>
    </div>
  );
}

/** Filter trigger button */
export function FilterButton({ onClick, activeCount = 0 }: { onClick: () => void; activeCount?: number }) {
  return (
    <button className="avs-btn avs-btn-secondary" onClick={onClick} type="button">
      <Filter size={14} />
      Filters
      {activeCount > 0 && <span className="avs-badge avs-badge-primary">{activeCount}</span>}
    </button>
  );
}
