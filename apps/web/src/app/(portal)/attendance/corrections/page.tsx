"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import { useState } from "react";

interface Correction {
  id: string; status: string; requestedStatus: string; reason: string; createdAt: string; reviewComment: string | null;
  record: { status: string; student: { publicId: string; fullName: string; collegeIdentityId: string } };
  session: { sessionDate: string; periodNumber: number; subject: { code: string; name: string }; section: { code: string; name: string } };
  requestedBy: { publicId: string; fullName: string };
}

export default function AttendanceCorrectionsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["attendance-corrections", status], queryFn: () => api.get<Correction[]>(`/attendance/corrections${status ? `?status=${status}` : ""}`) });
  const review = useMutation({
    mutationFn: ({ id, approved, comment }: { id: string; approved: boolean; comment?: string }) => api.post(`/attendance/corrections/${id}/${approved ? "approve" : "reject"}`, { ...(comment ? { comment } : {}) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["attendance-corrections"] }),
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The correction could not be reviewed."),
  });
  function decide(item: Correction, approved: boolean) { const comment = window.prompt(`${approved ? "Approval" : "Rejection"} comment (optional):`) ?? undefined; review.mutate({ id: item.id, approved, comment }); }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Academic governance</span><h1 className="page-title" style={{ marginTop: 6 }}>Attendance corrections</h1><p className="page-subtitle">Review every requested change without overwriting attendance history.</p></div><label className="select-field"><select aria-label="Correction status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All</option></select></label></div>
    {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message="You do not have permission to review corrections." /> : !query.data?.length ? <EmptyState title="No correction requests" /> : <div className="card table-wrap"><table><thead><tr><th>Student</th><th>Session</th><th>Requested change</th><th>Reason</th><th>Requested by</th><th>Status</th><th /></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td><strong>{item.record.student.fullName}</strong><small className="muted" style={{ display: "block" }}>{item.record.student.collegeIdentityId}</small></td><td>{item.session.section.name}<small className="muted" style={{ display: "block" }}>{item.session.subject.code} · {new Date(item.session.sessionDate).toLocaleDateString()} · period {item.session.periodNumber}</small></td><td><StatusBadge value={item.record.status} /> → <StatusBadge value={item.requestedStatus} /></td><td>{item.reason}</td><td>{item.requestedBy.fullName}</td><td><StatusBadge value={item.status} /></td><td>{item.status === "PENDING" && <div style={{ display: "flex", gap: 7 }}><button className="icon-button" aria-label="Approve correction" disabled={review.isPending} onClick={() => decide(item, true)}><Check /></button><button className="icon-button" aria-label="Reject correction" disabled={review.isPending} onClick={() => decide(item, false)}><X /></button></div>}</td></tr>)}</tbody></table></div>}
  </>;
}
