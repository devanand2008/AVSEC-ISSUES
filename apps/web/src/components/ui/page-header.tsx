"use client";

import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="avs-page-header">
      <div className="avs-page-header-text">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="caption" aria-label="Breadcrumb" style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "var(--avs-text-disabled)" }}>/</span>}
                {crumb.href ? (
                  <a href={crumb.href} style={{ color: "var(--avs-text-link)" }}>{crumb.label}</a>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="avs-page-header-actions">{actions}</div>}
    </div>
  );
}
