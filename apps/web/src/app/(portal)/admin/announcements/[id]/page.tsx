"use client";

import { ArrowLeft, BarChart3, CheckCircle, Download, Eye, EyeOff, Search, Send, XCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";

type BreakdownRow = { label: string; total: number; viewed: number; acknowledged: number };

type AnalyticsData = {
  announcement: {
    id: string;
    title: string;
    message: string;
    status: string;
    category: string;
    priority: string;
    publishAt: string | null;
    expiresAt: string | null;
    imageUrl: string | null;
    author: { fullName: string };
  };
  stats: {
    total: number;
    delivered: number;
    displayed: number;
    viewed: number;
    acknowledged: number;
    notViewed: number;
    failed: number;
    expired: number;
    viewRate: number;
    ackRate: number;
  };
  breakdowns?: {
    byRole: BreakdownRow[];
    byDepartment: BreakdownRow[];
    byProgramme: BreakdownRow[];
    bySection: BreakdownRow[];
  };
};

type Recipient = {
  user: {
    id: string;
    fullName: string;
    collegeIdentityId: string;
    email: string | null;
    status: string;
    roles: { role: { name: string } }[];
    studentProfile?: { department: { name: string }; section?: { name: string } };
    staffProfile?: { department: { name: string } | null };
  };
  deliveryStatus: string;
  firstDisplayedAt: string | null;
  firstViewedAt: string | null;
  acknowledgedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
};

type RecipientsData = {
  data: Recipient[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
};

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: LucideIcon; color: string }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ backgroundColor: `${color}15`, color, padding: 12, borderRadius: 8, display: "flex" }}>
        <Icon size={24} />
      </div>
      <div>
        <div className="muted" style={{ fontSize: "0.85rem", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function BreakdownChart({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.slice(0, 8).map((row) => {
          const percent = row.total ? Math.round((row.viewed / row.total) * 100) : 0;
          return (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 90px", gap: 12, alignItems: "center" }}>
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</strong>
              <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", background: "#10b981" }} />
              </div>
              <span className="muted">{row.viewed}/{row.total}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "-";
}

export default function AnnouncementAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const analytics = useQuery({
    queryKey: ["admin", "announcements", id, "analytics"],
    queryFn: () => api.get<AnalyticsData>(`/announcements/${id}/analytics`),
  });

  const recipientQuery = `page=${page}&pageSize=20${statusFilter ? `&deliveryStatus=${statusFilter}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  const recipients = useQuery({
    queryKey: ["admin", "announcements", id, "recipients", page, statusFilter, search],
    queryFn: () => api.get<RecipientsData>(`/announcements/${id}/recipients?${recipientQuery}`),
  });

  if (analytics.isLoading) return <LoadingState />;
  if (analytics.isError) return <ErrorState message="Could not load announcement analytics." />;
  if (!analytics.data) return null;

  const { announcement, stats, breakdowns } = analytics.data;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link href="/admin/announcements" className="back-link">
            <ArrowLeft size={16} /> Back to announcements
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <h1 className="page-title announcement-title">{announcement.title?.trim() || "Announcement"}</h1>
            <StatusBadge value={announcement.status} />
          </div>
          <div className="muted" style={{ marginTop: 4, display: "flex", gap: 16, fontSize: "0.9rem", flexWrap: "wrap" }}>
            <span>Category: <strong>{announcement.category.replace("_", " ")}</strong></span>
            <span>Priority: <strong>{announcement.priority}</strong></span>
            <span>Sent by: <strong>{announcement.author.fullName}</strong></span>
            <span>Published: <strong>{formatDate(announcement.publishAt)}</strong></span>
            <span>Expires: <strong>{formatDate(announcement.expiresAt)}</strong></span>
          </div>
        </div>
      </div>

      {announcement.imageUrl && (
        <div className="card" style={{ marginBottom: 24, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={announcement.imageUrl} alt="Announcement" style={{ width: "100%", maxHeight: 360, objectFit: "contain", background: "#f8fafc" }} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Recipients" value={stats.total} icon={BarChart3} color="#6366f1" />
        <StatCard label="Delivered" value={stats.delivered} icon={Send} color="#3b82f6" />
        <StatCard label="Displayed" value={stats.displayed} icon={Eye} color="#14b8a6" />
        <StatCard label="Viewed" value={`${stats.viewed} (${stats.viewRate}%)`} icon={Eye} color="#10b981" />
        <StatCard label="Not Viewed" value={stats.notViewed} icon={EyeOff} color="#f59e0b" />
        <StatCard label="Acknowledged" value={`${stats.acknowledged} (${stats.ackRate}%)`} icon={CheckCircle} color="#8b5cf6" />
        <StatCard label="Failed" value={stats.failed} icon={XCircle} color="#ef4444" />
        <StatCard label="Expired Before View" value={stats.expired} icon={XCircle} color="#64748b" />
      </div>

      {breakdowns && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
          <BreakdownChart title="Views by Role" rows={breakdowns.byRole} />
          <BreakdownChart title="Views by Department" rows={breakdowns.byDepartment} />
          <BreakdownChart title="Views by Programme" rows={breakdowns.byProgramme} />
          <BreakdownChart title="Views by Section" rows={breakdowns.bySection} />
        </div>
      )}

      <div className="card filters">
        <h3 style={{ margin: 0, paddingRight: 16 }}>Recipients List</h3>
        <label className="search-field" style={{ minWidth: 260 }}>
          <Search size={18} />
          <input
            aria-label="Search recipients"
            placeholder="Search name, ID, or email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="select-field" style={{ marginLeft: "auto" }}>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
            <option value="">All Delivery Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="DELIVERED">Delivered</option>
            <option value="DISPLAYED">Displayed</option>
            <option value="VIEWED">Viewed</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="FAILED">Failed</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => api.download(`/announcements/${id}/recipients/export.csv${statusFilter ? `?deliveryStatus=${statusFilter}` : ""}`, "announcement-recipients.csv")}
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {recipients.isLoading ? (
          <LoadingState />
        ) : recipients.isError ? (
          <ErrorState message="Could not load recipients." />
        ) : !recipients.data?.data.length ? (
          <EmptyState title="No recipients found" />
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User Name</th>
                  <th>Login ID</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Section</th>
                  <th>Delivery Status</th>
                  <th>Displayed Time</th>
                  <th>Viewed Time</th>
                  <th>Acknowledged Time</th>
                  <th>Open Count</th>
                  <th>Last Opened Time</th>
                </tr>
              </thead>
              <tbody>
                {recipients.data.data.map((item) => (
                  <tr key={item.user.id}>
                    <td>
                      <strong>{item.user.fullName}</strong>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>{item.user.email ?? "-"}</div>
                    </td>
                    <td>{item.user.collegeIdentityId}</td>
                    <td>{item.user.roles.map((role) => role.role.name).join(", ") || "-"}</td>
                    <td>{item.user.studentProfile?.department.name || item.user.staffProfile?.department?.name || "-"}</td>
                    <td>{item.user.studentProfile?.section?.name || "-"}</td>
                    <td><StatusBadge value={item.deliveryStatus} /></td>
                    <td>{formatDate(item.firstDisplayedAt)}</td>
                    <td>{formatDate(item.firstViewedAt)}</td>
                    <td>{formatDate(item.acknowledgedAt)}</td>
                    <td>{item.openCount}</td>
                    <td>{formatDate(item.lastOpenedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {recipients.data.meta.pageCount > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderTop: "1px solid var(--border)" }}>
                <span className="muted" style={{ fontSize: "0.9rem" }}>
                  Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, recipients.data.meta.total)} of {recipients.data.meta.total} recipients
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                    Previous
                  </button>
                  <button className="btn btn-secondary" disabled={page === recipients.data.meta.pageCount} onClick={() => setPage((current) => current + 1)}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
