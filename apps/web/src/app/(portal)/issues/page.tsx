"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Filter, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { IssueSummary, PageResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

export default function IssuesPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const query = useQuery({ queryKey: ["issues", search, status], queryFn: () => api.get<PageResponse<IssueSummary>>(`/issues?pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}`) });
  async function exportCsv() { setExporting(true); try { await api.download(`/reports/issues/export.csv${status ? `?status=${status}` : ""}`, `issues-${new Date().toISOString().slice(0, 10)}.csv`); } finally { setExporting(false); } }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Campus services</span><h1 className="page-title" style={{ marginTop: 6 }}>Issues</h1><p className="page-subtitle">Report, track and resolve campus service requests.</p></div><div style={{ display: "flex", gap: 8 }}>{user?.permissions.includes("issues.export") && <button className="btn btn-secondary" disabled={exporting} onClick={() => void exportCsv()}><Download size={18} />{exporting ? "Preparing…" : "Export CSV"}</button>}<Link className="btn btn-primary" href="/report-issue"><Plus size={18} />Report issue</Link></div></div>
    <div className="card filters"><label className="search-field"><Search size={18} /><input aria-label="Search issues" placeholder="Search issue number or title" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-field"><Filter size={17} /><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["NEW", "NEEDS_MANUAL_ASSIGNMENT", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR", "ON_HOLD", "RESOLVED", "VERIFICATION_PENDING", "VERIFIED", "CLOSED", "REOPENED", "REJECTED", "CANCELLED"].map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label></div>
    <div style={{ marginTop: 16 }}>{query.isLoading ? <LoadingState /> : query.isError ? <ErrorState /> : !query.data?.data.length ? <EmptyState title="No matching issues" message="Try another filter or report a new campus issue." /> : <div className="card table-wrap"><table><thead><tr><th>Issue</th><th>Location</th><th>Category</th><th>Assigned to</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead><tbody>{query.data.data.map((issue) => <tr key={issue.id}><td><Link href={`/issues/${issue.id}`} style={{ color: "var(--primary)", fontWeight: 750, minHeight: "auto" }}>{issue.issueNumber}</Link><div style={{ marginTop: 4 }}>{issue.title}</div></td><td>{issue.room.name}<small className="muted" style={{ display: "block" }}>{issue.room.code}</small></td><td>{issue.category.name}</td><td>{issue.assignedTo?.fullName ?? issue.team?.name ?? "Awaiting assignment"}</td><td><StatusBadge value={issue.priority} /></td><td><StatusBadge value={issue.status} /></td><td>{new Date(issue.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}</div>
  </>;
}
