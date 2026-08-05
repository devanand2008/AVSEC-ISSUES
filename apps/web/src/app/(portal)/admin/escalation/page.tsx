"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock3, TrendingUp } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";

interface EscalationEvent {
  id: string;
  level: number;
  reason: string;
  escalatedAt: string;
  nextEscalationAt: string | null;
  notificationStatus: string;
  issue: {
    id: string;
    issueNumber: string;
    title: string;
    status: string;
    priority: string;
    room: { name: string } | null;
    area: { name: string } | null;
    customAreaName: string | null;
  };
}

export default function EscalationPage() {
  const query = useQuery({ queryKey: ["escalation-events"], queryFn: () => api.get<EscalationEvent[]>("/escalation-events") });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message="Escalation data could not be loaded." />;

  const events = query.data ?? [];
  const now = new Date();
  const active = events.filter((e) => e.nextEscalationAt && new Date(e.nextEscalationAt) > now);
  const maxLevel = events.length ? Math.max(...events.map((e) => e.level)) : 0;

  const cards = [
    { label: "Total escalations", value: events.length, icon: TrendingUp, color: "#6366f1", bg: "#eef2ff" },
    { label: "Active chains", value: active.length, icon: AlertTriangle, color: "#d97706", bg: "#fff7ed" },
    { label: "Max level reached", value: maxLevel, icon: Clock3, color: "#dc2626", bg: "#fff1f2" },
  ];

  return <>
    <div className="page-heading"><div><span className="eyebrow">Issue management</span><h1 className="page-title" style={{ marginTop: 6 }}>Escalation events</h1><p className="page-subtitle">Track SLA breaches and escalation chains across all issues.</p></div></div>

    <section className="metric-grid">{cards.map(({ label, value, icon: Icon, color, bg }) => <article className="card metric-card" key={label}><span className="metric-icon" style={{ color, background: bg }}><Icon size={21} /></span><div><span className="muted">{label}</span><strong>{value}</strong></div></article>)}</section>

    <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2>Escalation history</h2><p>Most recent escalation events across all issues.</p></div></div>
      {events.length === 0 ? <div className="empty" style={{ padding: 40 }}>No escalation events recorded yet. Escalations are triggered when issues breach their SLA deadlines.</div> : <table className="data-table"><thead><tr><th>Issue</th><th>Location</th><th>Level</th><th>Priority</th><th>Status</th><th>Reason</th><th>Notification</th><th>Escalated</th><th>Next</th></tr></thead><tbody>
        {events.map((event) => {
          const isOverdue = event.nextEscalationAt && new Date(event.nextEscalationAt) < now;
          return <tr key={event.id}>
            <td><Link href={`/issues/${event.issue.id}`} style={{ fontWeight: 600, color: "var(--primary)" }}>{event.issue.issueNumber}</Link><br /><small className="muted">{event.issue.title}</small></td>
            <td>{event.issue.room?.name ?? event.issue.area?.name ?? event.issue.customAreaName ?? "Unspecified"}</td>
            <td><span className="badge" style={{ background: event.level >= 3 ? "#fef2f2" : event.level >= 2 ? "#fff7ed" : "#f0fdf4", color: event.level >= 3 ? "#dc2626" : event.level >= 2 ? "#d97706" : "#16a34a" }}>L{event.level}</span></td>
            <td><StatusBadge value={event.issue.priority} /></td>
            <td><StatusBadge value={event.issue.status} /></td>
            <td className="muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.reason}</td>
            <td><StatusBadge value={event.notificationStatus} /></td>
            <td className="muted">{new Date(event.escalatedAt).toLocaleString()}</td>
            <td style={isOverdue ? { color: "var(--error)", fontWeight: 600 } : {}}>{event.nextEscalationAt ? new Date(event.nextEscalationAt).toLocaleString() : "—"}</td>
          </tr>;
        })}
      </tbody></table>}
    </section>
  </>;
}
