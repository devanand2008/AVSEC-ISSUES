"use client";

import { Inbox, SearchX, Users } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  preset?: "no-results" | "no-people" | "no-data";
}

const presetIcons: Record<string, ReactNode> = {
  "no-results": <SearchX />,
  "no-people": <Users />,
  "no-data": <Inbox />,
};

export function EmptyState({ icon, title, description, action, preset }: EmptyStateProps) {
  const displayIcon = icon ?? (preset ? presetIcons[preset] : <Inbox />);

  return (
    <div className="avs-empty-state">
      {displayIcon}
      <h3 className="avs-empty-state-title">{title}</h3>
      {description && <p className="avs-empty-state-desc">{description}</p>}
      {action}
    </div>
  );
}
