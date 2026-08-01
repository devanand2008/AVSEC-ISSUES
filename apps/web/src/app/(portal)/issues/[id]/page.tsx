"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  MapPin,
  MessageSquare,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface IssueDetail {
  id: string;
  issueNumber: string;
  title: string;
  description: string;
  exactPosition: string | null;
  status: string;
  priority: string;
  createdAt: string;
  acknowledgementDueAt: string | null;
  resolutionDueAt: string | null;
  expectedCompletionAt: string | null;
  occurrenceCount: number;
  affectedUserCount: number;
  room: { name: string; code: string; floor: { name: string; block: { name: string; campus: { name: string } } } };
  category: { name: string };
  issueType: { name: string } | null;
  asset: { name: string } | null;
  reporter: { publicId: string; fullName: string };
  assignedTo: { publicId: string; fullName: string } | null;
  team: { id: string; name: string } | null;
  comments: Array<{ id: string; body: string; isInternal: boolean; createdAt: string; author: { fullName: string } }>;
  statusHistory: Array<{ id: string; previousStatus: string | null; newStatus: string; comment: string | null; createdAt: string; changedBy: { fullName: string } }>;
  timelines: Array<{ id: string; expectedCompletionAt: string; reason: string; progressNote: string; requiredParts: string | null; requiredApproval: boolean; createdAt: string; supersededAt: string | null; createdBy: { fullName: string } }>;
  resolution: { resolutionNote: string; completionPhotoFileId: string; partsUsed: string | null; completedAt: string; completedBy: { fullName: string } } | null;
  attachments: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: string; purpose: string; sha256: string | null; createdAt: string; uploadedBy: { publicId: string; fullName: string } }>;
}

interface AssignmentTeam {
  id: string;
  code: string;
  name: string;
  members: Array<{ id: string; publicId: string; fullName: string; isPrimary: boolean; maxOpenIssues: number | null; openIssues: number }>;
}

export default function IssueDetailPage() {
  const id = useParams<{ id: string }>().id;
  const client = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assignment, setAssignment] = useState({ teamId: "", userId: "", reason: "" });
  const [timeline, setTimeline] = useState({ expectedCompletionAt: "", reason: "", progressNote: "", requiredParts: "", requiredApproval: false });
  const [finish, setFinish] = useState({ resolutionNote: "", completionPhotoFileId: "", partsUsed: "", costNote: "" });

  const query = useQuery({ queryKey: ["issue", id], queryFn: () => api.get<IssueDetail>(`/issues/${id}`) });
  const assignmentOptions = useQuery({
    queryKey: ["issue-assignment-options"],
    queryFn: () => api.get<AssignmentTeam[]>("/issues/assignment-options"),
    enabled: Boolean(user?.permissions.includes("issues.assign")),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["issue", id] });

  const status = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body?: unknown }) => api.post(`/issues/${id}/${endpoint}`, body),
    onSuccess: refresh,
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The status could not be updated."),
  });
  const assign = useMutation({
    mutationFn: () => api.post(`/issues/${id}/assign`, {
      teamId: assignment.teamId || undefined,
      userId: assignment.userId || undefined,
      reason: assignment.reason.trim(),
    }),
    onSuccess: () => {
      setAssignment({ teamId: "", userId: "", reason: "" });
      void refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The issue could not be assigned."),
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`/issues/${id}/comments`, { body: comment }),
    onSuccess: () => {
      setComment("");
      void refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Comment could not be posted."),
  });
  const addTimeline = useMutation({
    mutationFn: () => api.post(`/issues/${id}/timeline`, {
      ...timeline,
      expectedCompletionAt: new Date(timeline.expectedCompletionAt).toISOString(),
      requiredParts: timeline.requiredParts || undefined,
    }),
    onSuccess: () => { setTimeline({ expectedCompletionAt: "", reason: "", progressNote: "", requiredParts: "", requiredApproval: false }); void refresh(); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Timeline could not be saved."),
  });
  const finishWork = useMutation({
    mutationFn: () => api.post(`/issues/${id}/finish`, {
      ...finish,
      completedAt: new Date().toISOString(),
      partsUsed: finish.partsUsed || undefined,
      costNote: finish.costNote || undefined,
    }),
    onSuccess: refresh,
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Completion could not be submitted."),
  });

  async function upload(file: File | undefined, requestedPurpose?: "ISSUE_UPDATE" | "ISSUE_RESOLUTION") {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const purpose = requestedPurpose ?? "ISSUE_UPDATE";
      const signed = await api.post<{ storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>(`/issues/${id}/attachments/presign`, {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose,
      });
      await api.upload(signed.uploadUrl, file, signed.requiredHeaders);
      const completed = await api.post<{ id: string }>(`/issues/${id}/attachments/complete`, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, purpose, storageKey: signed.storageKey });
      if (purpose === "ISSUE_RESOLUTION") setFinish((current) => ({ ...current, completionPhotoFileId: completed.id }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Attachment upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function download(attachmentId: string) {
    try {
      const result = await api.get<{ url: string }>(`/issues/${id}/attachments/${attachmentId}/download`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Download failed.");
    }
  }

  async function remove(attachmentId: string) {
    if (!window.confirm("Remove this attachment from the issue? The audit record is retained.")) return;
    try {
      await api.delete(`/issues/${id}/attachments/${attachmentId}`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Attachment could not be removed.");
    }
  }

  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (comment.trim()) addComment.mutate();
  }

  function submitAssignment(event: FormEvent) {
    event.preventDefault();
    if (assignment.reason.trim()) assign.mutate();
  }

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message="This issue does not exist or is outside your access scope." />;

  const issue = query.data;
  const canAcknowledge = user?.permissions.includes("issues.acknowledge") && issue.status === "ASSIGNED";
  const canStart = user?.permissions.includes("issues.start") && ["ACKNOWLEDGED", "REOPENED"].includes(issue.status);
  const canResolve = user?.permissions.includes("issues.resolve") && ["IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR"].includes(issue.status);
  const canVerify = (user?.permissions.includes("issues.verify") || user?.id === issue.reporter.publicId) && ["RESOLVED", "VERIFICATION_PENDING"].includes(issue.status);
  const canAssign = Boolean(user?.permissions.includes("issues.assign") && ["NEW", "NEEDS_MANUAL_ASSIGNMENT", "ASSIGNED", "REOPENED"].includes(issue.status));
  const canUpload = Boolean(user && (user.id === issue.reporter.publicId || user.permissions.includes("issues.update_work") || user.permissions.includes("issues.assign")));
  const selectedTeam = assignmentOptions.data?.find((team) => team.id === assignment.teamId);

  return <>
    <div className="page-heading">
      <div>
        <Link href="/issues" style={{ color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center", minHeight: "auto", marginBottom: 9 }}><ArrowLeft size={16} />All issues</Link>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h1 className="page-title">{issue.issueNumber}</h1>
          <StatusBadge value={issue.status} />
          <StatusBadge value={issue.priority} />
        </div>
        <p className="page-subtitle">Reported {new Date(issue.createdAt).toLocaleString()} · Reported {issue.occurrenceCount} {issue.occurrenceCount === 1 ? "time" : "times"} · {issue.affectedUserCount} reporters</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {canAcknowledge && <button className="btn btn-primary" onClick={() => status.mutate({ endpoint: "acknowledge" })}><CheckCircle2 size={17} />Acknowledge</button>}
        {canStart && <button className="btn btn-primary" onClick={() => status.mutate({ endpoint: "start" })}><Play size={17} />Start work</button>}
        {canVerify && <>
          <button className="btn btn-primary" onClick={() => status.mutate({ endpoint: "verify", body: { accepted: true, comment: "Resolution confirmed." } })}>Verify resolution</button>
          <button className="btn btn-danger" onClick={() => status.mutate({ endpoint: "verify", body: { accepted: false, comment: "The problem is not resolved." } })}><RotateCcw size={17} />Reopen</button>
        </>}
      </div>
    </div>
    {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

    <div className="issue-detail-grid">
      <div style={{ display: "grid", gap: 18 }}>
        <section className="card detail-section">
          <div className="section-head"><div><h2>{issue.title}</h2><p>{issue.category.name}{issue.issueType ? ` - ${issue.issueType.name}` : ""}</p></div></div>
          <div className="detail-body">
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{issue.description}</p>
            {issue.exactPosition && <p className="muted"><MapPin size={16} /> Exact position: {issue.exactPosition}</p>}
            <div className="detail-meta">
              <div><MapPin /><span><small>Location</small><strong>{issue.room.floor.block.campus.name} / {issue.room.floor.block.name} / {issue.room.floor.name} / {issue.room.name}</strong></span></div>
              <div><UserRound /><span><small>Responsible</small><strong>{issue.assignedTo?.fullName ?? issue.team?.name ?? "Awaiting assignment"}</strong></span></div>
              <div><Clock3 /><span><small>Resolution due</small><strong>{issue.resolutionDueAt ? new Date(issue.resolutionDueAt).toLocaleString() : "No active SLA"}</strong></span></div>
              <div><Clock3 /><span><small>Expected completion</small><strong>{issue.expectedCompletionAt ? new Date(issue.expectedCompletionAt).toLocaleString() : "Timeline not added"}</strong></span></div>
            </div>
          </div>
        </section>

        {canResolve && <section className="card">
          <div className="section-head"><div><h2>Maintenance workflow</h2><p>Add an estimated timeline, then finish with photo evidence.</p></div></div>
          <div className="detail-body" style={{ display: "grid", gap: 14 }}>
            <form style={{ display: "grid", gap: 10 }} onSubmit={(event) => { event.preventDefault(); addTimeline.mutate(); }}>
              <h3>Repair timeline</h3>
              <input type="datetime-local" required value={timeline.expectedCompletionAt} onChange={(event) => setTimeline({ ...timeline, expectedCompletionAt: event.target.value })} />
              <input required minLength={3} placeholder="Reason for this estimate" value={timeline.reason} onChange={(event) => setTimeline({ ...timeline, reason: event.target.value })} />
              <textarea required minLength={2} placeholder="Latest progress update" value={timeline.progressNote} onChange={(event) => setTimeline({ ...timeline, progressNote: event.target.value })} />
              <input placeholder="Required parts (optional)" value={timeline.requiredParts} onChange={(event) => setTimeline({ ...timeline, requiredParts: event.target.value })} />
              <label><input type="checkbox" checked={timeline.requiredApproval} onChange={(event) => setTimeline({ ...timeline, requiredApproval: event.target.checked })} /> Approval required</label>
              <button className="btn btn-secondary" disabled={addTimeline.isPending}>Save timeline</button>
            </form>
            <form style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 14 }} onSubmit={(event) => { event.preventDefault(); finishWork.mutate(); }}>
              <h3>Finish work</h3>
              <textarea required minLength={3} placeholder="Resolution note" value={finish.resolutionNote} onChange={(event) => setFinish({ ...finish, resolutionNote: event.target.value })} />
              <input placeholder="Parts used (optional)" value={finish.partsUsed} onChange={(event) => setFinish({ ...finish, partsUsed: event.target.value })} />
              <input placeholder="Cost note (optional)" value={finish.costNote} onChange={(event) => setFinish({ ...finish, costNote: event.target.value })} />
              <label className="upload-button"><Paperclip size={18} /><span>{uploading ? "Uploading..." : finish.completionPhotoFileId ? "Completion photo ready" : "Upload required completion photo"}</span><input type="file" required={!finish.completionPhotoFileId} accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0], "ISSUE_RESOLUTION")} /></label>
              <button className="btn btn-primary" disabled={finishWork.isPending || !finish.completionPhotoFileId || !finish.resolutionNote.trim()}><CheckCircle2 size={17} />Finish work</button>
            </form>
          </div>
        </section>}

        {issue.resolution && <section className="card detail-section"><div className="section-head"><div><h2>Resolution</h2><p>Completed {new Date(issue.resolution.completedAt).toLocaleString()} by {issue.resolution.completedBy.fullName}</p></div></div><div className="detail-body"><p>{issue.resolution.resolutionNote}</p>{issue.resolution.partsUsed && <p><strong>Parts used:</strong> {issue.resolution.partsUsed}</p>}</div></section>}

        <section className="card">
          <div className="section-head"><div><h2>Updates</h2><p>Conversation and work notes</p></div></div>
          <div className="comments">
            {issue.comments.length ? issue.comments.map((item) => <article key={item.id}><span className="avatar">{item.author.fullName[0]}</span><div><header><strong>{item.author.fullName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small>{item.isInternal && <StatusBadge value="INTERNAL" />}</header><p>{item.body}</p></div></article>) : <div className="empty">No comments have been added.</div>}
          </div>
          <form className="comment-form" onSubmit={submitComment}>
            <MessageSquare size={18} />
            <input aria-label="Add update" placeholder="Add an update or ask a question..." value={comment} onChange={(event) => setComment(event.target.value)} />
            <button className="btn btn-primary" disabled={!comment.trim() || addComment.isPending}><Send size={17} />Send</button>
          </form>
        </section>
      </div>

      <aside style={{ display: "grid", gap: 18, alignContent: "start" }}>
        {canAssign && <section className="card">
          <div className="section-head"><div><h2>Assignment</h2><p>Route this issue to a responsible team or person</p></div></div>
          <form className="comment-form" style={{ alignItems: "stretch", gridTemplateColumns: "1fr", paddingTop: 0 }} onSubmit={submitAssignment}>
            <select aria-label="Responsible team" value={assignment.teamId} onChange={(event) => setAssignment((current) => ({ ...current, teamId: event.target.value, userId: "" }))}>
              <option value="">Select team</option>
              {assignmentOptions.data?.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <select aria-label="Responsible person" value={assignment.userId} onChange={(event) => setAssignment((current) => ({ ...current, userId: event.target.value }))} disabled={!selectedTeam}>
              <option value="">Use team queue</option>
              {selectedTeam?.members.map((member) => <option key={member.publicId} value={member.publicId}>{member.fullName}{member.isPrimary ? " (primary)" : ""}</option>)}
            </select>
            <input aria-label="Assignment reason" placeholder="Reason for manual assignment" value={assignment.reason} onChange={(event) => setAssignment((current) => ({ ...current, reason: event.target.value }))} />
            <button className="btn btn-primary" disabled={assign.isPending || !assignment.reason.trim()}><Send size={17} />Assign issue</button>
          </form>
        </section>}

        <section className="card">
          <div className="section-head"><div><h2>Attachments</h2><p>Verified private evidence</p></div></div>
          <div className="attachments">
            {issue.attachments.map((item) => <div className="attachment-row" key={item.id}>
              <button aria-label={`Download ${item.originalName}`} onClick={() => void download(item.id)}><Paperclip size={18} /><span><strong>{item.originalName}</strong><small>{(Number(item.sizeBytes) / 1024 / 1024).toFixed(1)} MB - by {item.uploadedBy.fullName}</small></span><Download size={17} /></button>
              {(item.uploadedBy.publicId === user?.id || user?.permissions.includes("issues.update_work") || user?.permissions.includes("issues.assign")) && <button className="attachment-remove" aria-label={`Remove ${item.originalName}`} onClick={() => void remove(item.id)}><Trash2 size={16} /></button>}
            </div>)}
            {canUpload && <label className="upload-button"><Paperclip size={18} /><span>{uploading ? "Uploading..." : "Add evidence"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,audio/mpeg,audio/mp4,audio/webm" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} /></label>}
          </div>
        </section>

        <section className="card">
          <div className="section-head"><div><h2>Timeline</h2><p>Immutable status history</p></div></div>
          <ol className="timeline">
            {issue.timelines.map((item) => <li key={item.id}><span /><div><strong>Expected {new Date(item.expectedCompletionAt).toLocaleString()}</strong><small>{new Date(item.createdAt).toLocaleString()} by {item.createdBy.fullName}{item.supersededAt ? " · revised" : " · current"}</small><p>{item.progressNote}</p><p className="muted">{item.reason}</p></div></li>)}
            {issue.statusHistory.map((item) => <li key={item.id}><span /><div><strong>{item.newStatus.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()} by {item.changedBy.fullName}</small>{item.comment && <p>{item.comment}</p>}</div></li>)}
          </ol>
        </section>
      </aside>
    </div>
  </>;
}
