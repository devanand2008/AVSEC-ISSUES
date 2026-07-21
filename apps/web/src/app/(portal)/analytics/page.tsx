"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

/* ─── Types ─── */
interface IssueTrendPoint { date: string; created: number; resolved: number; overdue: number }
interface SlaTrendPoint { week: string; compliant: number; breached: number; total: number; complianceRate: number | null }
interface AttendanceTrendPoint { date: string; present: number; absent: number; late: number; excused: number }
interface Breakdown { name: string; count: number }
interface DashboardData {
  issuesByStatus: Array<{ status: string; count: number }>;
  issuesByCategory: Breakdown[];
  issuesByBlock: Breakdown[];
  issuesByDepartment: Breakdown[];
  frequentlyDamagedAssets: Breakdown[];
  repeatProblemLocations: Breakdown[];
  metrics: { slaCompliancePercentage: number | null; averageResolutionMinutes: number | null; escalatedIssues: number };
}

/* ─── Palette ─── */
const COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2", "#ca8a04", "#9333ea"];
const STATUS_COLORS: Record<string, string> = {
  NEW: "#2563eb", ASSIGNED: "#7c3aed", IN_PROGRESS: "#0891b2", RESOLVED: "#059669", VERIFIED: "#16a34a",
  OVERDUE: "#dc2626", CLOSED: "#64748b", ACKNOWLEDGED: "#d97706",
};

function fmt(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtWeek(date: string) {
  return "w/c " + new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function pieLabel({ name, percent }: { name?: string; percent?: unknown }) {
  const value = typeof percent === "number" ? percent : 0;
  return `${name ?? "Unknown"} ${(value * 100).toFixed(0)}%`;
}

/* ─── Page ─── */
export default function AnalyticsPage() {
  const { user } = useAuth();
  const [issueDays, setIssueDays] = useState(30);
  const [slaWeeks, setSlaWeeks] = useState(12);
  const [attendanceDays, setAttendanceDays] = useState(30);

  const canAttendance = user?.permissions.some((p) => p.startsWith("attendance.read"));
  const canIssues = user?.permissions.some((p) => p.startsWith("issues"));

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/reports/dashboard") });
  const issueTrend = useQuery({ queryKey: ["analytics", "issues", issueDays], queryFn: () => api.get<IssueTrendPoint[]>(`/reports/analytics/issues?days=${issueDays}`), enabled: canIssues });
  const slaTrend = useQuery({ queryKey: ["analytics", "sla", slaWeeks], queryFn: () => api.get<SlaTrendPoint[]>(`/reports/analytics/sla?weeks=${slaWeeks}`), enabled: canIssues });
  const attendanceTrend = useQuery({ queryKey: ["analytics", "attendance", attendanceDays], queryFn: () => api.get<AttendanceTrendPoint[]>(`/reports/analytics/attendance?days=${attendanceDays}`), enabled: canAttendance });

  const pieData = useMemo(() => dashboard.data?.issuesByStatus.map((item) => ({ name: item.status.replace(/_/g, " "), value: item.count, color: STATUS_COLORS[item.status] ?? "#94a3b8" })) ?? [], [dashboard.data]);
  const categoryData = useMemo(() => dashboard.data?.issuesByCategory.slice(0, 8) ?? [], [dashboard.data]);
  const locationData = useMemo(() => dashboard.data?.issuesByBlock.slice(0, 8) ?? [], [dashboard.data]);
  const deptData = useMemo(() => dashboard.data?.issuesByDepartment?.slice(0, 8) ?? [], [dashboard.data]);
  const assetData = useMemo(() => dashboard.data?.frequentlyDamagedAssets?.slice(0, 8) ?? [], [dashboard.data]);

  if (dashboard.isLoading) return <LoadingState />;
  if (dashboard.isError) return <ErrorState message="Analytics data could not be loaded." />;

  const m = dashboard.data!.metrics;

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">Intelligence</span>
        <h1 className="page-title" style={{ marginTop: 6 }}>Analytics</h1>
        <p className="page-subtitle">Trend analysis, SLA compliance, attendance patterns and issue distribution.</p>
      </div>
    </div>

    {/* ─── KPI row ─── */}
    <section className="metric-grid" style={{ marginBottom: 24 }}>
      <article className="card metric-card"><span className="metric-icon" style={{ color: m.slaCompliancePercentage != null && m.slaCompliancePercentage >= 80 ? "#16a34a" : "#d97706", background: m.slaCompliancePercentage != null && m.slaCompliancePercentage >= 80 ? "#f0fdf4" : "#fff7ed" }}><span style={{ fontSize: 18, fontWeight: 800 }}>%</span></span><div><span className="muted">SLA compliance</span><strong>{m.slaCompliancePercentage != null ? `${m.slaCompliancePercentage}%` : "—"}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#2563eb", background: "#eff6ff" }}><span style={{ fontSize: 18, fontWeight: 800 }}>⏱</span></span><div><span className="muted">Avg. resolution</span><strong>{m.averageResolutionMinutes != null ? `${m.averageResolutionMinutes} min` : "—"}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#dc2626", background: "#fff1f2" }}><span style={{ fontSize: 18, fontWeight: 800 }}>↑</span></span><div><span className="muted">Escalated issues</span><strong>{m.escalatedIssues}</strong></div></article>
    </section>

    {/* ─── Issue trend line chart ─── */}
    {canIssues && <section className="card chart-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><h2>Issue volume trend</h2><span className="muted">Daily created, resolved and overdue issues</span></div>
        <select className="input" style={{ width: 120 }} value={issueDays} onChange={(e) => setIssueDays(Number(e.target.value))}>
          <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
        </select>
      </div>
      {issueTrend.isLoading ? <LoadingState rows={3} /> : issueTrend.data && <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={issueTrend.data} margin={{ top: 4, right: 16, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
            <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.15} /><stop offset="95%" stopColor="#059669" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip labelFormatter={fmt} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="created" name="Created" stroke="#2563eb" fill="url(#gradCreated)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#059669" fill="url(#gradResolved)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="overdue" name="Overdue" stroke="#dc2626" strokeWidth={2} dot={false} strokeDasharray="4 3" />
        </AreaChart>
      </ResponsiveContainer>}
    </section>}

    {/* ─── SLA compliance trend ─── */}
    {canIssues && <section className="card chart-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><h2>SLA compliance trend</h2><span className="muted">Weekly resolution SLA compliance rate (%)</span></div>
        <select className="input" style={{ width: 120 }} value={slaWeeks} onChange={(e) => setSlaWeeks(Number(e.target.value))}>
          <option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option><option value={24}>24 weeks</option>
        </select>
      </div>
      {slaTrend.isLoading ? <LoadingState rows={3} /> : slaTrend.data && <ResponsiveContainer width="100%" height={260}>
        <LineChart data={slaTrend.data} margin={{ top: 4, right: 16, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="week" tickFormatter={fmtWeek} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} unit="%" />
          <Tooltip labelFormatter={fmtWeek} formatter={(v: number) => [`${v ?? "—"}%`, "SLA compliance"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }} />
          <Line type="monotone" dataKey="complianceRate" name="SLA compliance" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4, fill: "#2563eb" }} activeDot={{ r: 6 }} connectNulls />
          <Line type="monotone" dataKey="compliant" name="Compliant" stroke="#059669" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          <Line type="monotone" dataKey="breached" name="Breached" stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>}
    </section>}

    {/* ─── Distribution grid ─── */}
    <div className="chart-grid" style={{ marginBottom: 18 }}>
      {/* Issue status pie */}
      {canIssues && <section className="card chart-card">
        <h2>Issues by status</h2><span className="muted">Current open issue distribution</span>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} label={pieLabel} labelLine={false}>
            {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie><Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} /></PieChart>
        </ResponsiveContainer>
      </section>}

      {/* Issue by category bar */}
      {canIssues && <section className="card chart-card">
        <h2>Issues by category</h2><span className="muted">Top issue categories across all campus</span>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart layout="vertical" data={categoryData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} width={120} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
            <Bar dataKey="count" name="Issues" radius={[0, 5, 5, 0]} maxBarSize={22}>
              {categoryData.map((_entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>}

      {/* Issue by block bar */}
      {canIssues && <section className="card chart-card">
        <h2>Issues by block</h2><span className="muted">Maintenance load distribution by campus block</span>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={locationData} margin={{ top: 4, right: 16, left: -24, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} angle={-25} textAnchor="end" />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
            <Bar dataKey="count" name="Issues" radius={[5, 5, 0, 0]} maxBarSize={36}>
              {locationData.map((_entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>}

      {/* Issues by department */}
      {canIssues && deptData.length > 0 && <section className="card chart-card">
        <h2>Issues by department</h2><span className="muted">Department-wise issue volume</span>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart layout="vertical" data={deptData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} width={110} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
            <Bar dataKey="count" name="Issues" radius={[0, 5, 5, 0]} maxBarSize={20} fill="#7c3aed" />
          </BarChart>
        </ResponsiveContainer>
      </section>}

      {/* Frequently damaged assets */}
      {canIssues && assetData.length > 0 && <section className="card chart-card">
        <h2>Frequently reported assets</h2><span className="muted">Assets with the most linked issue reports</span>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart layout="vertical" data={assetData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} width={140} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
            <Bar dataKey="count" name="Issues" radius={[0, 5, 5, 0]} maxBarSize={20} fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </section>}
    </div>

    {/* ─── Attendance trend ─── */}
    {canAttendance && <section className="card chart-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><h2>Attendance trend</h2><span className="muted">Daily attendance status counts in your authorized scope</span></div>
        <select className="input" style={{ width: 120 }} value={attendanceDays} onChange={(e) => setAttendanceDays(Number(e.target.value))}>
          <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option>
        </select>
      </div>
      {attendanceTrend.isLoading ? <LoadingState rows={3} /> : attendanceTrend.data && <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={attendanceTrend.data} margin={{ top: 4, right: 16, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="gradPresent" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.2} /><stop offset="95%" stopColor="#059669" stopOpacity={0} /></linearGradient>
            <linearGradient id="gradAbsent" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} /><stop offset="95%" stopColor="#dc2626" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip labelFormatter={fmt} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="present" name="Present" stroke="#059669" fill="url(#gradPresent)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="absent" name="Absent" stroke="#dc2626" fill="url(#gradAbsent)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="late" name="Late" stroke="#d97706" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          <Line type="monotone" dataKey="excused" name="Excused" stroke="#7c3aed" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </AreaChart>
      </ResponsiveContainer>}
    </section>}
  </>;
}
