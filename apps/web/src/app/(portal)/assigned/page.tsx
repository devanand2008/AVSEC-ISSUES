"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, FileWarning, Wrench } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Issue {
  id: string;
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  affectedUserCount: number;
  createdAt: string;
  acknowledgementDueAt: string | null;
  resolutionDueAt: string | null;
  room: { name: string; code: string };
  category: { name: string };
}

interface AssignedResponse {
  data: Issue[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export default function AssignedIssuesPage() {
  const { user } = useAuth();
  const pending = useQuery({ queryKey: ["assigned", "pending"], queryFn: () => api.get<AssignedResponse>("/issues?assigned=true&status=ASSIGNED&pageSize=50") });
  const inProgress = useQuery({ queryKey: ["assigned", "in-progress"], queryFn: () => api.get<AssignedResponse>("/issues?assigned=true&status=IN_PROGRESS&pageSize=50") });
  const acknowledged = useQuery({ queryKey: ["assigned", "acknowledged"], queryFn: () => api.get<AssignedResponse>("/issues?assigned=true&status=ACKNOWLEDGED&pageSize=50") });

  const isLoading = pending.isLoading || inProgress.isLoading || acknowledged.isLoading;
  const isError = pending.isError || inProgress.isError || acknowledged.isError;

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const now = new Date();
  const pendingIssues = pending.data?.data ?? [];
  const activeIssues = [...(acknowledged.data?.data ?? []), ...(inProgress.data?.data ?? [])];
  const overdueIssues = [...pendingIssues, ...activeIssues].filter((issue) => issue.resolutionDueAt && new Date(issue.resolutionDueAt) < now);

  const cards = [
    { label: "Awaiting acknowledgement", value: pendingIssues.length, icon: FileWarning, color: "#d97706", bg: "#fff7ed" },
    { label: "Active work", value: activeIssues.length, icon: Wrench, color: "#2563eb", bg: "#eff6ff" },
    { label: "Overdue", value: overdueIssues.length, icon: Clock3, color: "#dc2626", bg: "#fff1f2" },
    { label: "Total assigned", value: (pending.data?.meta.total ?? 0) + (inProgress.data?.meta.total ?? 0) + (acknowledged.data?.meta.total ?? 0), icon: CheckCircle2, color: "#16a34a", bg: "#f0fdf4" },
  ];

  return <>
    <div className="page-heading"><div><span className="eyebrow">My assignments</span><h1 className="page-title" style={{ marginTop: 6 }}>Assigned issues</h1><p className="page-subtitle">Issues currently assigned to you or your team, {user?.fullName.split(" ")[0]}.</p></div></div>

    <section className="metric-grid">{cards.map(({ label, value, icon: Icon, color, bg }) => <article className="card metric-card" key={label}><span className="metric-icon" style={{ color, background: bg }}><Icon size={21} /></span><div><span className="muted">{label}</span><strong>{value}</strong></div></article>)}</section>

    {pendingIssues.length > 0 && <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2><AlertTriangle size={18} style={{ color: "#d97706", verticalAlign: "-3px" }} /> Needs acknowledgement</h2><p>These issues are waiting for you to acknowledge and start work.</p></div></div>
      <IssueTable issues={pendingIssues} showDue />
    </section>}

    {activeIssues.length > 0 && <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2><Wrench size={18} style={{ color: "#2563eb", verticalAlign: "-3px" }} /> In progress</h2><p>Issues you are actively working on.</p></div></div>
      <IssueTable issues={activeIssues} showDue />
    </section>}

    {overdueIssues.length > 0 && <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2><Clock3 size={18} style={{ color: "#dc2626", verticalAlign: "-3px" }} /> Overdue</h2><p>Past their resolution deadline.</p></div></div>
      <IssueTable issues={overdueIssues} showDue />
    </section>}

    {pendingIssues.length === 0 && activeIssues.length === 0 && <div className="card" style={{ marginTop: 18 }}><div className="empty" style={{ padding: 40 }}>No issues are currently assigned to you. Check back later or view <Link href="/issues" style={{ color: "var(--primary)" }}>all issues</Link>.</div></div>}
  </>;
}

function IssueTable({ issues, showDue }: { issues: Issue[]; showDue?: boolean }) {
  const now = new Date();
  return <table className="data-table"><thead><tr><th>Issue</th><th>Location</th><th>Category</th><th>Priority</th><th>Status</th><th>Affected</th>{showDue && <th>Resolution due</th>}<th>Created</th></tr></thead><tbody>
    {issues.map((issue) => {
      const isOverdue = issue.resolutionDueAt && new Date(issue.resolutionDueAt) < now;
      return <tr key={issue.id}>
        <td><Link href={`/issues/${issue.id}`} style={{ fontWeight: 600, color: "var(--primary)" }}>{issue.issueNumber}</Link><br /><small className="muted">{issue.title}</small></td>
        <td>{issue.room.name} <small className="muted">{issue.room.code}</small></td>
        <td>{issue.category.name}</td>
        <td><StatusBadge value={issue.priority} /></td>
        <td><StatusBadge value={issue.status} /></td>
        <td>{issue.affectedUserCount}</td>
        {showDue && <td style={isOverdue ? { color: "var(--error)", fontWeight: 600 } : {}}>{issue.resolutionDueAt ? new Date(issue.resolutionDueAt).toLocaleString() : "—"}</td>}
        <td className="muted">{new Date(issue.createdAt).toLocaleDateString()}</td>
      </tr>;
    })}
  </tbody></table>;
}
