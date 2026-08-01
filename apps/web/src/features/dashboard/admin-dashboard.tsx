import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  FileWarning,
  Plus,
  UserRoundX,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/ui/page-header";

interface Breakdown {
  name: string;
  count: number;
}
interface DashboardData {
  metrics: {
    openIssues: number;
    newIssues: number;
    unassignedIssues: number;
    criticalIssues: number;
    overdueIssues: number;
    resolvedToday: number;
    unreadNotifications: number;
    averageAcknowledgementMinutes: number | null;
    averageResolutionMinutes: number | null;
    slaCompliancePercentage: number | null;
    escalatedIssues: number;
    notificationFailures: number;
  };
  recentIssues: Array<{
    id: string;
    issueNumber: string;
    title: string;
    status: string;
    priority: string;
    updatedAt: string;
  }>;
  issuesByStatus: Array<{ status: string; count: number }>;
  issuesByCategory: Breakdown[];
  issuesByBlock: Breakdown[];
  repeatProblemLocations: Breakdown[];
}

export function AdminDashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/reports/dashboard"),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState />;
  const { metrics } = query.data;
  const cards = [
    {
      label: "Open issues",
      value: metrics.openIssues,
      icon: Wrench,
      color: "#2563eb",
      bg: "#eff6ff",
    },
    {
      label: "New",
      value: metrics.newIssues,
      icon: FileWarning,
      color: "#1e3a8a",
      bg: "#eff6ff",
    },
    {
      label: "Unassigned",
      value: metrics.unassignedIssues,
      icon: UserRoundX,
      color: "#d97706",
      bg: "#fff7ed",
    },
    {
      label: "Critical",
      value: metrics.criticalIssues,
      icon: AlertTriangle,
      color: "#dc2626",
      bg: "#fff1f2",
    },
    {
      label: "Overdue",
      value: metrics.overdueIssues,
      icon: Clock3,
      color: "#d97706",
      bg: "#fff7ed",
    },
    {
      label: "Resolved today",
      value: metrics.resolvedToday,
      icon: CheckCircle2,
      color: "#16a34a",
      bg: "#f0fdf4",
    },
  ];
  const canAttendance = user?.permissions.some(
    (permission) =>
      permission.startsWith("attendance.read") ||
      permission === "attendance.session.create",
  );
  return (
    <div className="main-with-bottom-nav">
      <PageHeader
        title={`Good day, ${user?.fullName.split(" ")[0] ?? "Admin"}`}
        description="Here is what needs attention in your authorised campus scope."
        breadcrumbs={[
          {
            label: new Intl.DateTimeFormat(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date()),
          },
        ]}
        actions={
          user?.permissions.includes("issues.create") ? (
            <Link className="avs-btn avs-btn-primary" href="/report-issue">
              <Plus size={16} />
              Report an issue
            </Link>
          ) : undefined
        }
      />

      {user?.permissions.includes("ai.use") && (
        <section
          className="avs-card"
          style={{
            padding: "var(--space-5)",
            marginBottom: "var(--space-6)",
            background: "linear-gradient(135deg, var(--avs-primary-ghost), var(--avs-page-alt))",
          }}
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  background: "var(--avs-primary-surface)",
                  color: "var(--avs-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={24} />
              </div>
              <div>
                <h2 className="heading-4" style={{ margin: 0 }}>AVS Bot</h2>
                <p className="body-text-sm" style={{ margin: "2px 0 0" }}>
                  Ask about attendance, timetable, subjects, learning resources, and campus issues.
                </p>
              </div>
            </div>
            <Link className="avs-btn avs-btn-primary" href="/avs-bot">
              <Bot size={16} />
              Open AVS Bot
            </Link>
          </div>
        </section>
      )}

      <section className="grid grid-auto-fit gap-4 mb-6">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div
            className="avs-stat-card"
            key={label}
            onClick={() => { window.location.href = "/issues"; }}
            style={{ cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
              <span className="avs-stat-card-label">{label}</span>
              <div className="avs-stat-card-icon" style={{ background: bg, color }}>
                <Icon size={18} />
              </div>
            </div>
            <span className="avs-stat-card-value">{value}</span>
          </div>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Recent service issues</h2>
              <p>Latest reports available in your scope</p>
            </div>
            <Link href="/issues">View all</Link>
          </div>
          {query.data.recentIssues.length ? (
            <div className="issue-list">
              {query.data.recentIssues.map((issue) => (
                <Link href={`/issues/${issue.id}`} key={issue.id}>
                  <span className="list-icon">
                    <FileWarning size={18} />
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
              No issue activity is currently visible in your scope.
            </div>
          )}
        </section>
        <aside className="card action-card">
          <div className="section-head">
            <div>
              <h2>Service levels</h2>
              <p>Current scoped performance</p>
            </div>
            <Link
              href="/analytics"
              style={{
                color: "var(--primary)",
                fontWeight: 700,
                minHeight: "auto",
              }}
            >
              Full analytics
            </Link>
          </div>
          <div style={{ display: "grid", gap: 12, padding: "0 4px 10px" }}>
            <span>
              <strong style={{ display: "block", fontSize: 22 }}>
                {metrics.slaCompliancePercentage == null
                  ? "—"
                  : `${metrics.slaCompliancePercentage}%`}
              </strong>
              <small className="muted">Resolution SLA compliance</small>
            </span>
            <span>
              <strong style={{ display: "block", fontSize: 22 }}>
                {metrics.averageAcknowledgementMinutes == null
                  ? "—"
                  : `${metrics.averageAcknowledgementMinutes} min`}
              </strong>
              <small className="muted">Average acknowledgement</small>
            </span>
            <span>
              <strong style={{ display: "block", fontSize: 22 }}>
                {metrics.averageResolutionMinutes == null
                  ? "—"
                  : `${metrics.averageResolutionMinutes} min`}
              </strong>
              <small className="muted">Average resolution</small>
            </span>
            <span>
              <strong style={{ display: "block", fontSize: 22 }}>
                {metrics.notificationFailures}
              </strong>
              <small className="muted">Delivery failures</small>
            </span>
          </div>
        </aside>
      </div>
      <div className="dashboard-grid" style={{ marginTop: 18 }}>
        <BreakdownCard
          title="Issues by category"
          rows={query.data.issuesByCategory}
        />
        <BreakdownCard
          title="Issues by block"
          rows={query.data.issuesByBlock}
        />
      </div>
      <section className="card action-card" style={{ marginTop: 18 }}>
        <div className="section-head">
          <div>
            <h2>Quick actions</h2>
            <p>Common tasks</p>
          </div>
        </div>
        {user?.permissions.includes("issues.create") && (
          <Link href="/report-issue">
            <span>
              <FileWarning />
            </span>
            <div>
              <strong>Report campus issue</strong>
              <small>Room, equipment or safety</small>
            </div>
          </Link>
        )}
        {canAttendance && (
          <Link href="/attendance">
            <span>
              <CheckCircle2 />
            </span>
            <div>
              <strong>Open attendance</strong>
              <small>View or mark a session</small>
            </div>
          </Link>
        )}
        <Link href="/notifications">
          <span>
            <Bell />
          </span>
          <div>
            <strong>Notifications</strong>
            <small>{metrics.unreadNotifications} unread updates</small>
          </div>
        </Link>
        <Link href="/analytics">
          <span>
            <span style={{ display: "grid", placeItems: "center" }}>📊</span>
          </span>
          <div>
            <strong>Analytics dashboard</strong>
            <small>Trends, SLA compliance and charts</small>
          </div>
        </Link>
      </section>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="card" style={{ padding: 20 }}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <p>Top values in your current scope</p>
        </div>
      </div>
      {rows.slice(0, 8).map((row) => (
        <div className="subject-row" key={row.name}>
          <span>
            <strong>{row.name}</strong>
          </span>
          <div>
            <span style={{ width: `${(row.count / maximum) * 100}%` }} />
          </div>
          <strong>{row.count}</strong>
        </div>
      ))}
      {!rows.length && <div className="empty">No data yet.</div>}
    </section>
  );
}
