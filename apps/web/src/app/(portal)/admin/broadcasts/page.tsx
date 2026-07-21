"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

/* ─── types ─── */
interface Broadcast {
  id: string;
  title: string;
  body: string;
  audienceType: "ALL" | "ROLE" | "DEPARTMENT" | "SECTION" | "INDIVIDUAL";
  audienceValue: string | null;
  status: "DRAFT" | "SCHEDULED" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  author: { publicId: string; fullName: string };
}
interface BroadcastMeta { page: number; pageSize: number; total: number; pageCount: number }
interface Department { id: string; code: string; name: string }
interface Role { code: string; name: string }
interface Section { id: string; code: string; name: string }

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: "All Users",
  ROLE: "By Role",
  DEPARTMENT: "By Department",
  SECTION: "By Class/Section",
  INDIVIDUAL: "Individual User",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#64748b",
  SCHEDULED: "#d97706",
  QUEUED: "#2563eb",
  SENDING: "#7c3aed",
  SENT: "#16a34a",
  FAILED: "#dc2626",
  CANCELLED: "#94a3b8",
};

function StatusBadge({ status }: { status: string }) {
  const Icon = status === "SENT" ? CheckCheck : status === "SENDING" ? Loader2 : status === "FAILED" ? XCircle : status === "SCHEDULED" ? Clock : status === "CANCELLED" ? X : Check;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        background: STATUS_COLORS[status] + "18",
        color: STATUS_COLORS[status],
        border: `1px solid ${STATUS_COLORS[status]}30`,
      }}
    >
      <Icon size={12} className={status === "SENDING" ? "spin" : undefined} />
      {status}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/* ─── Compose form ─── */
interface ComposeForm {
  title: string;
  body: string;
  audienceType: "ALL" | "ROLE" | "DEPARTMENT" | "SECTION" | "INDIVIDUAL";
  audienceValue: string;
  scheduledAt: string;
}
const blank: ComposeForm = { title: "", body: "", audienceType: "ALL", audienceValue: "", scheduledAt: "" };

function ComposeBroadcast({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ComposeForm>(blank);
  const [error, setError] = useState("");

  const departments = useQuery({
    queryKey: ["departments-for-broadcast"],
    queryFn: () => api.get<Department[]>("/academic/departments"),
  });
  const roles = useQuery({
    queryKey: ["roles-for-broadcast"],
    queryFn: () => api.get<Role[]>("/roles"),
  });
  const sections = useQuery({
    queryKey: ["sections-for-broadcast"],
    queryFn: () => api.get<Section[]>("/academic/sections"),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post<Broadcast>("/broadcasts", {
      title: form.title.trim(),
      body: form.body.trim(),
      audienceType: form.audienceType,
      audienceValue: form.audienceType !== "ALL" ? form.audienceValue || undefined : undefined,
      scheduledAt: form.scheduledAt || undefined,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Failed to save broadcast."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.body.trim()) return setError("Message body is required.");
    if (form.audienceType !== "ALL" && !form.audienceValue) return setError("Please specify the audience value.");
    saveMutation.mutate();
  }

  return (
    <div className="modal-backdrop">
      <form className="card modal-panel" onSubmit={submit} style={{ maxWidth: 680, width: "100%" }}>
        <header>
          <div>
            <span className="eyebrow">Broadcast message</span>
            <h2>Compose Broadcast</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        {error && <div className="error-box">{error}</div>}
        <div className="form-grid">
          <div className="field form-span">
            <label>Title <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              className="input"
              required
              maxLength={180}
              placeholder="e.g. Important: Campus Closure Notice"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Audience Type <span style={{ color: "#dc2626" }}>*</span></label>
            <select
              className="input"
              value={form.audienceType}
              onChange={(e) => setForm({ ...form, audienceType: e.target.value as ComposeForm["audienceType"], audienceValue: "" })}
            >
              {Object.entries(AUDIENCE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          {form.audienceType !== "ALL" && (
            <div className="field">
              <label>
                {form.audienceType === "ROLE" ? "Role" :
                  form.audienceType === "DEPARTMENT" ? "Department" :
                  form.audienceType === "SECTION" ? "Section" : "College ID or User ID"}
                <span style={{ color: "#dc2626" }}> *</span>
              </label>
              {form.audienceType === "ROLE" && (
                <select
                  className="input"
                  value={form.audienceValue}
                  onChange={(e) => setForm({ ...form, audienceValue: e.target.value })}
                >
                  <option value="">Select role…</option>
                  {roles.data?.map((role) => (
                    <option key={role.code} value={role.code}>{role.name} ({role.code})</option>
                  ))}
                </select>
              )}
              {form.audienceType === "DEPARTMENT" && (
                <select
                  className="input"
                  value={form.audienceValue}
                  onChange={(e) => setForm({ ...form, audienceValue: e.target.value })}
                >
                  <option value="">Select department…</option>
                  {departments.data?.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              )}
              {form.audienceType === "SECTION" && (
                <select
                  className="input"
                  value={form.audienceValue}
                  onChange={(e) => setForm({ ...form, audienceValue: e.target.value })}
                >
                  <option value="">Select section…</option>
                  {sections.data?.map((section) => (
                    <option key={section.id} value={section.id}>{section.name} ({section.code})</option>
                  ))}
                </select>
              )}
              {form.audienceType === "INDIVIDUAL" && (
                <input
                  className="input"
                  placeholder="Enter College ID (e.g. 22EE001)"
                  value={form.audienceValue}
                  onChange={(e) => setForm({ ...form, audienceValue: e.target.value })}
                />
              )}
            </div>
          )}
          <div className="field">
            <label>Schedule (optional)</label>
            <input
              className="input"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
            <small className="muted">Leave blank to save as draft and send manually.</small>
          </div>
          <div className="field form-span">
            <label>Message Body <span style={{ color: "#dc2626" }}>*</span></label>
            <textarea
              className="input"
              rows={6}
              required
              placeholder="Write your broadcast message here…"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            <small className="muted">{form.body.length} characters</small>
          </div>
        </div>
        <footer>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveMutation.isPending}
            id="save-broadcast-btn"
          >
            {saveMutation.isPending ? <><Loader2 className="spin" size={16} />Saving…</> : <><Check size={16} />Save as Draft</>}
          </button>
        </footer>
      </form>
    </div>
  );
}

/* ─── Detail view ─── */
function BroadcastDetail({ broadcast, onClose, onRefresh }: { broadcast: Broadcast; onClose: () => void; onRefresh: () => void }) {
  const { user } = useAuth();
  const canSend = user?.permissions.includes("broadcasts.send");
  const [error, setError] = useState("");

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${broadcast.id}/send`),
    onSuccess: () => { onRefresh(); onClose(); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Failed to send broadcast."),
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${broadcast.id}/cancel`),
    onSuccess: () => { onRefresh(); onClose(); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Failed to cancel broadcast."),
  });

  return (
    <div className="modal-backdrop">
      <section className="card modal-panel" style={{ maxWidth: 600, width: "100%" }}>
        <header>
          <div>
            <span className="eyebrow">Broadcast Details</span>
            <h2>{broadcast.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        {error && <div className="error-box">{error}</div>}
        <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatusBadge status={broadcast.status} />
            <span style={{ fontSize: 13, color: "#64748b" }}>
              <Users size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
              {AUDIENCE_LABELS[broadcast.audienceType]}{broadcast.audienceValue ? ` — ${broadcast.audienceValue}` : ""}
            </span>
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #dce6f2", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ margin: 0, lineHeight: 1.6, fontSize: 14, whiteSpace: "pre-wrap" }}>{broadcast.body}</p>
          </div>
          {broadcast.status === "SENT" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Total Recipients", value: broadcast.totalRecipients, color: "#2563eb" },
                { label: "Delivered", value: broadcast.deliveredCount, color: "#16a34a" },
                { label: "Failed", value: broadcast.failedCount, color: "#dc2626" },
              ].map((stat) => (
                <div key={stat.label} style={{ background: stat.color + "0f", border: `1px solid ${stat.color}20`, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            <span>Created by {broadcast.author.fullName} · {formatDate(broadcast.createdAt)}</span>
            {broadcast.sentAt && <span> · Sent {formatDate(broadcast.sentAt)}</span>}
          </div>
        </div>
        <footer>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {["DRAFT", "SCHEDULED"].includes(broadcast.status) && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={cancelMutation.isPending}
              onClick={() => window.confirm("Cancel this broadcast?") && cancelMutation.mutate()}
              style={{ color: "#dc2626" }}
            >
              {cancelMutation.isPending ? <Loader2 className="spin" size={16} /> : <XCircle size={16} />}
              Cancel
            </button>
          )}
          {canSend && ["DRAFT", "SCHEDULED"].includes(broadcast.status) && (
            <button
              id="send-broadcast-btn"
              type="button"
              className="btn btn-primary"
              disabled={sendMutation.isPending}
              onClick={() => window.confirm(`Send this broadcast to all recipients under audience: "${AUDIENCE_LABELS[broadcast.audienceType]}"?`) && sendMutation.mutate()}
            >
              {sendMutation.isPending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              {sendMutation.isPending ? "Sending…" : "Send Now"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

/* ─── Main page ─── */
export default function BroadcastPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<Broadcast | null>(null);

  const canCreate = user?.permissions.includes("broadcasts.create");
  const canSend = user?.permissions.includes("broadcasts.send");

  const broadcasts = useQuery({
    queryKey: ["broadcasts", page],
    queryFn: () => api.get<{ data: Broadcast[]; meta: BroadcastMeta }>(`/broadcasts?page=${page}&pageSize=15`),
    enabled: Boolean(canCreate || canSend),
  });

  function refresh() {
    void client.invalidateQueries({ queryKey: ["broadcasts"] });
  }

  if (!canCreate && !canSend) {
    return (
      <div className="page-heading">
        <ErrorState message="You do not have permission to access broadcast messaging." />
      </div>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Communications</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>Broadcast Messages</h1>
          <p className="page-subtitle">Send targeted messages to specific audiences across the college.</p>
        </div>
        <div className="heading-actions">
          <button
            className="btn btn-secondary"
            onClick={refresh}
            disabled={broadcasts.isFetching}
            id="refresh-broadcasts-btn"
          >
            <RefreshCw size={16} className={broadcasts.isFetching ? "spin" : undefined} />
            Refresh
          </button>
          {canCreate && (
            <button
              id="compose-broadcast-btn"
              className="btn btn-primary"
              onClick={() => setComposing(true)}
            >
              <Plus size={18} />
              Compose Broadcast
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {broadcasts.data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
          {[
            { label: "Total Broadcasts", value: broadcasts.data.meta.total, icon: <Megaphone size={20} />, color: "#0b3d91" },
            { label: "Sent", value: broadcasts.data.data.filter((b) => b.status === "SENT").length, icon: <CheckCheck size={20} />, color: "#16a34a" },
            { label: "Drafts", value: broadcasts.data.data.filter((b) => b.status === "DRAFT").length, icon: <Clock size={20} />, color: "#d97706" },
            { label: "Total Recipients", value: broadcasts.data.data.reduce((sum, b) => sum + b.totalRecipients, 0), icon: <Users size={20} />, color: "#7c3aed" },
          ].map((stat) => (
            <div key={stat.label} className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px" }}>
              <span style={{ color: stat.color, background: stat.color + "12", padding: 10, borderRadius: 12 }}>{stat.icon}</span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {broadcasts.isLoading ? (
        <LoadingState />
      ) : broadcasts.isError ? (
        <ErrorState message="Failed to load broadcasts." />
      ) : !broadcasts.data?.data.length ? (
        <EmptyState title="No broadcasts yet" message="Compose your first broadcast to reach your college community." />
      ) : (
        <>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Author</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {broadcasts.data.data.map((broadcast) => (
                  <tr key={broadcast.id}>
                    <td>
                      <strong>{broadcast.title}</strong>
                      <small className="muted" style={{ display: "block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {broadcast.body.slice(0, 80)}
                      </small>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Users size={13} style={{ color: "#64748b" }} />
                        <span>{AUDIENCE_LABELS[broadcast.audienceType]}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={broadcast.status} /></td>
                    <td>
                      {broadcast.status === "SENT" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{broadcast.deliveredCount}/{broadcast.totalRecipients}</span>
                          {broadcast.failedCount > 0 && (
                            <span style={{ fontSize: 11, color: "#dc2626" }}>
                              <AlertTriangle size={10} style={{ verticalAlign: "middle" }} /> {broadcast.failedCount} failed
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{broadcast.author.fullName}</td>
                    <td>
                      <time title={broadcast.createdAt}>{formatDate(broadcast.createdAt)}</time>
                    </td>
                    <td>
                      <button
                        id={`view-broadcast-${broadcast.id}`}
                        className="btn btn-secondary"
                        onClick={() => setSelected(broadcast)}
                      >
                        View <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {broadcasts.data.meta.pageCount > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                id="prev-page-btn"
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                Page {broadcasts.data.meta.page} of {broadcasts.data.meta.pageCount}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page >= broadcasts.data.meta.pageCount}
                onClick={() => setPage((p) => p + 1)}
                id="next-page-btn"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {composing && (
        <ComposeBroadcast
          onClose={() => setComposing(false)}
          onSaved={refresh}
        />
      )}

      {selected && (
        <BroadcastDetail
          broadcast={selected}
          onClose={() => setSelected(null)}
          onRefresh={refresh}
        />
      )}
    </>
  );
}
