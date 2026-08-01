"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";

interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  id?: string;
}

export function ActionMenu({ items, id }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  const dangerItems = items.filter((i) => i.danger);
  const normalItems = items.filter((i) => !i.danger);

  return (
    <div className="avs-action-menu" ref={ref}>
      <button
        id={id}
        className="avs-btn avs-btn-ghost avs-btn-icon"
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Actions"
        type="button"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="avs-action-menu-dropdown" role="menu">
          {normalItems.map((item, i) => (
            <button
              key={i}
              className="avs-action-menu-item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { item.onClick(); close(); }}
              type="button"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          {dangerItems.length > 0 && normalItems.length > 0 && (
            <div className="avs-action-menu-separator" role="separator" />
          )}
          {dangerItems.map((item, i) => (
            <button
              key={`d${i}`}
              className="avs-action-menu-item avs-action-menu-item-danger"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { item.onClick(); close(); }}
              type="button"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
