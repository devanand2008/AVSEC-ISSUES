import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Bell, Clock3, ShieldAlert, Star } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import type { DashboardResponse } from "./dashboard-types";

export function LeadershipDashboard({ variant }: { variant: "principal" | "vice-principal" }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", variant],
    queryFn: () => api.get<DashboardResponse>("/reports/dashboard"),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;

  const { metrics, recentIssues } = query.data;
  const principal = variant === "principal";
  const cards = principal
    ? [
        { label: "Critical issues", value: metrics.criticalIssues, icon: ShieldAlert },
        { label: "Overdue issues", value: metrics.overdueIssues, icon: Clock3 },
        { label: "Escalated issues", value: metrics.escalatedIssues, icon: AlertTriangle },
        { label: "Unread alerts", value: metrics.unreadNotifications, icon: Bell },
      ]
    : [
        { label: "New issues", value: metrics.newIssues, icon: AlertTriangle },
        { label: "Unassigned", value: metrics.unassignedIssues, icon: ShieldAlert },
        { label: "Overdue issues", value: metrics.overdueIssues, icon: Clock3 },
        { label: "Delivery failures", value: metrics.notificationFailures, icon: Bell },
      ];

  return (
    <div className="main-with-bottom-nav">
      <PageHeader
        title={`${principal ? "Principal" : "Vice Principal"} overview`}
        description={`Good day, ${user?.fullName}. Review college operations and priority alerts.`}
        breadcrumbs={[{ label: principal ? "Institution leadership" : "Operational leadership" }]}
      />
      <section className="grid grid-auto-fit gap-4 mb-6">
        {cards.map(({ label, value, icon: Icon }) => (
          <Link className="avs-stat-card" href="/issues" key={label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="avs-stat-card-label">{label}</span>
              <span className="avs-stat-card-icon"><Icon size={18} /></span>
            </div>
            <span className="avs-stat-card-value">{value}</span>
          </Link>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <div className="section-head">
            <div><h2>Priority issue activity</h2><p>Latest records in your authorised scope</p></div>
            <Link href="/issues">View all</Link>
          </div>
          {recentIssues.length ? (
            <div className="issue-list">
              {recentIssues.map((issue) => (
                <Link href={`/issues/${issue.id}`} key={issue.id}>
                  <span className="list-icon"><AlertTriangle size={18} /></span>
                  <span className="list-copy"><strong>{issue.title}</strong><small>{issue.issueNumber}</small></span>
                  <StatusBadge value={issue.status} />
                </Link>
              ))}
            </div>
          ) : <div className="empty">No issue activity is visible in your scope.</div>}
        </section>
        <aside className="card action-card">
          <div className="section-head"><div><h2>Leadership tools</h2><p>College-wide insights</p></div></div>
          <Link href={`/${variant}/attendance`}><span><BarChart3 /></span><div><strong>Attendance</strong><small>College and staff overview</small></div></Link>
          <Link href={`/${variant}/feedback-dashboard`}><span><Star /></span><div><strong>Feedback</strong><small>Ratings and alerts</small></div></Link>
          <Link href={`/${variant}/management-insights`}><span><BarChart3 /></span><div><strong>Management insights</strong><small>Operational trends</small></div></Link>
        </aside>
      </div>
    </div>
  );
}
