import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Bell, BookOpen, CheckCircle2, FileWarning, Users } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/query-state";
import type { DashboardResponse } from "./dashboard-types";

export function FacultyDashboard() {
  const { user } = useAuth();
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
        title={`Welcome, ${user?.fullName.split(" ")[0] ?? "Faculty"}`}
        description="Here is your daily academic overview."
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
        <div className="avs-stat-card">
           <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
              <span className="avs-stat-card-label">Open Issues</span>
              <div className="avs-stat-card-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
                <FileWarning size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics.openIssues}</span>
        </div>
        
        <div className="avs-stat-card">
           <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
              <span className="avs-stat-card-label">Unread Notifications</span>
              <div className="avs-stat-card-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                <Bell size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics.unreadNotifications}</span>
        </div>
      </section>

      <div className="dashboard-grid">
         <section className="card">
            <div className="section-head">
               <div>
                  <h2>Recent Activity</h2>
                  <p>Issues visible in your assigned scope</p>
               </div>
               <Link href="/issues">View all</Link>
            </div>
            {recentIssues.length ? (
              <div className="issue-list">
                {recentIssues.map((issue) => (
                  <Link href={`/issues/${issue.id}`} key={issue.id}>
                    <span className="list-icon"><FileWarning size={18} /></span>
                    <span className="list-copy">
                      <strong>{issue.title}</strong>
                      <small>{issue.issueNumber}</small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
                No recent activity in your assigned scope.
              </div>
            )}
         </section>
         
         <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
             <aside className="card action-card">
                <div className="section-head">
                    <div>
                    <h2>Quick Actions</h2>
                    </div>
                </div>
                <Link href="/attendance">
                    <span><CheckCircle2 /></span>
                    <div>
                        <strong>Mark Attendance</strong>
                        <small>Record student attendance</small>
                    </div>
                </Link>
                <Link href="/learn/manage">
                    <span><BookOpen /></span>
                    <div>
                        <strong>Upload Resource</strong>
                        <small>Share notes and assignments</small>
                    </div>
                </Link>
                <Link href="/admin/students">
                    <span><Users /></span>
                    <div>
                        <strong>Student Directory</strong>
                        <small>View profiles and performance</small>
                    </div>
                </Link>
             </aside>
         </div>
      </div>
    </div>
  );
}
