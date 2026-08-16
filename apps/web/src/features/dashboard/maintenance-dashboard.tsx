import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Wrench } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LoadingState, ErrorState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import type { DashboardResponse } from "./dashboard-types";
import { OperationsSummary } from "./operations-summary";
import { DashboardAlerts } from "./dashboard-alerts";

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
    <div className="main-with-bottom-nav" data-notification-ui="true">
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

      <DashboardAlerts />
      <OperationsSummary metrics={metrics} />

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
