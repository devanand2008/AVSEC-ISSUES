import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Clock, Wrench } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LoadingState, ErrorState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import type { DashboardResponse } from "./dashboard-types";

export function MaintenanceDashboard() {
  const { user } = useAuth();

  // Reusing the same generic dashboard endpoint for now, 
  // since it scopes issues to the user's campus automatically.
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/reports/dashboard"),
  });
  
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;
  
  const { metrics, recentIssues } = query.data;
  
  return (
    <div className="main-with-bottom-nav">
      <PageHeader
        title={`Maintenance Dashboard`}
        description={`Hello, ${user?.fullName}. Here are your tasks for today.`}
        breadcrumbs={[
          {
            label: new Intl.DateTimeFormat(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date()),
          },
        ]}
      />

      <section className="grid grid-auto-fit gap-4 mb-6">
        <div className="avs-stat-card" onClick={() => { window.location.href = "/issues"; }} style={{ cursor: "pointer" }}>
           <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
              <span className="avs-stat-card-label">Open Issues</span>
              <div className="avs-stat-card-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
                <Wrench size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics.openIssues}</span>
        </div>
        
        <div className="avs-stat-card" onClick={() => { window.location.href = "/issues"; }} style={{ cursor: "pointer" }}>
           <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
              <span className="avs-stat-card-label">Overdue</span>
              <div className="avs-stat-card-icon" style={{ background: "#fff7ed", color: "#d97706" }}>
                <Clock size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics.overdueIssues}</span>
        </div>
      </section>

      <div className="dashboard-grid">
         <section className="card">
            <div className="section-head">
               <div>
                  <h2>Recent Assigned Issues</h2>
                  <p>Tasks in your queue</p>
               </div>
               <Link href="/issues">View all</Link>
            </div>
            {recentIssues?.length ? (
            <div className="issue-list">
              {recentIssues.map((issue) => (
                <Link href={`/issues/${issue.id}`} key={issue.id}>
                  <span className="list-icon">
                    <Wrench size={18} />
                  </span>
                  <span className="list-copy">
                    <strong>{issue.title}</strong>
                    <small>
                      {issue.issueNumber} · Updated{" "}
                      {new Date(issue.updatedAt).toLocaleString()}
                    </small>
                  </span>
                  <StatusBadge value={issue.status} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">
              No pending tasks at the moment.
            </div>
          )}
         </section>
      </div>
    </div>
  );
}
