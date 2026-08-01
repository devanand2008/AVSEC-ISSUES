import { useQuery } from "@tanstack/react-query";
import { BookOpen, Calendar, MessageSquare, QrCode, Bot, Bell } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState } from "@/components/query-state";
import type { DashboardResponse } from "./dashboard-types";

export function StudentDashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/reports/dashboard"),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;

  const { metrics } = query.data;

  return (
    <div className="main-with-bottom-nav">
      <PageHeader
        title={`Welcome, ${user?.fullName.split(" ")[0] ?? "Student"}`}
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
           <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="avs-stat-card-label">Open Issues</span>
              <div className="avs-stat-card-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
                <Calendar size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics?.openIssues ?? 0}</span>
        </div>
        
        <div className="avs-stat-card">
           <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="avs-stat-card-label">Notifications</span>
              <div className="avs-stat-card-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                <Bell size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{metrics?.unreadNotifications ?? 0}</span>
        </div>
      </section>

      <div className="dashboard-grid">
         <section className="card">
            <div className="section-head">
               <div>
                  <h2>Recent Announcements</h2>
                  <p>Stay updated with college news</p>
               </div>
               <Link href="/announcements">View all</Link>
            </div>
            <div className="empty" style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
               No new announcements.
            </div>
         </section>
         
         <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
             <aside className="card action-card">
                <div className="section-head">
                    <div>
                    <h2>Quick Links</h2>
                    </div>
                </div>
                <Link href="/learn">
                    <span><BookOpen /></span>
                    <div>
                        <strong>Learning Resources</strong>
                        <small>Access study materials</small>
                    </div>
                </Link>
                <Link href="/scan-qr">
                    <span><QrCode /></span>
                    <div>
                        <strong>Scan Feedback QR</strong>
                        <small>Give feedback by scanning</small>
                    </div>
                </Link>
                <Link href="/messages">
                    <span><MessageSquare /></span>
                    <div>
                        <strong>Messages</strong>
                        <small>Chat with faculty</small>
                    </div>
                </Link>
                {user?.permissions.includes("ai.use") && (
                  <Link href="/avs-bot">
                      <span><Bot /></span>
                      <div>
                          <strong>AVS Bot</strong>
                          <small>Ask questions</small>
                      </div>
                  </Link>
                )}
             </aside>
         </div>
      </div>
    </div>
  );
}
