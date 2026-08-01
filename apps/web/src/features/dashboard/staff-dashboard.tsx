import { useQuery } from "@tanstack/react-query";
import { Bell, FileWarning, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import type { DashboardResponse } from "./dashboard-types";

export function StaffDashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", "staff"],
    queryFn: () => api.get<DashboardResponse>("/reports/dashboard"),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;
  const { metrics } = query.data;
  return (
    <div className="main-with-bottom-nav">
      <PageHeader title={`Welcome, ${user?.fullName}`} description="Your college services and updates." breadcrumbs={[{ label: "Staff dashboard" }]} />
      <section className="grid grid-auto-fit gap-4 mb-6">
        <Link className="avs-stat-card" href="/issues"><span className="avs-stat-card-label">Open issues</span><span className="avs-stat-card-value">{metrics.openIssues}</span></Link>
        <Link className="avs-stat-card" href="/notifications"><span className="avs-stat-card-label">Unread notifications</span><span className="avs-stat-card-value">{metrics.unreadNotifications}</span></Link>
      </section>
      <section className="card action-card">
        <div className="section-head"><div><h2>Quick actions</h2><p>Common staff tasks</p></div></div>
        {user?.permissions.includes("issues.create") && <Link href="/report-issue"><span><Plus /></span><div><strong>Report an issue</strong><small>Campus, room or equipment</small></div></Link>}
        <Link href="/issues"><span><FileWarning /></span><div><strong>Issue status</strong><small>Track reports in your scope</small></div></Link>
        <Link href="/messages"><span><MessageSquare /></span><div><strong>Messages</strong><small>College conversations</small></div></Link>
        <Link href="/notifications"><span><Bell /></span><div><strong>Notifications</strong><small>Official updates</small></div></Link>
      </section>
    </div>
  );
}
