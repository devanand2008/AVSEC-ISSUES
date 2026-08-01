import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, Clock3, FileWarning, Star, Users } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import type { DashboardResponse } from "./dashboard-types";

export function HodDashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", "hod"],
    queryFn: () => api.get<DashboardResponse>("/reports/dashboard"),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;
  const { metrics } = query.data;
  const cards = [
    { label: "Department issues", value: metrics.openIssues, icon: FileWarning, href: "/issues" },
    { label: "Overdue issues", value: metrics.overdueIssues, icon: Clock3, href: "/issues" },
    { label: "Resolved today", value: metrics.resolvedToday, icon: Users, href: "/issues" },
    { label: "Unread alerts", value: metrics.unreadNotifications, icon: Bell, href: "/notifications" },
  ];
  return (
    <div className="main-with-bottom-nav">
      <PageHeader
        title="Department overview"
        description={`Welcome, ${user?.fullName}. Review academic and operational activity in your department.`}
        breadcrumbs={[{ label: "HOD dashboard" }]}
      />
      <section className="grid grid-auto-fit gap-4 mb-6">
        {cards.map(({ label, value, icon: Icon, href }) => (
          <Link className="avs-stat-card" href={href} key={label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="avs-stat-card-label">{label}</span>
              <span className="avs-stat-card-icon"><Icon size={18} /></span>
            </div>
            <span className="avs-stat-card-value">{value}</span>
          </Link>
        ))}
      </section>
      <section className="card action-card">
        <div className="section-head"><div><h2>Department tools</h2><p>Academic and student support</p></div></div>
        <Link href="/hod/attendance"><span><Users /></span><div><strong>Attendance overview</strong><small>Classes and low-attendance alerts</small></div></Link>
        <Link href="/hod/feedback-dashboard"><span><Star /></span><div><strong>Department feedback</strong><small>Staff ratings and trends</small></div></Link>
        <Link href="/learn"><span><BookOpen /></span><div><strong>AVS Learn</strong><small>Department learning resources</small></div></Link>
      </section>
    </div>
  );
}
