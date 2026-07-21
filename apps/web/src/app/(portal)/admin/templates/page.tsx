"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";

interface Template {
  id: string;
  code: string;
  channel: string;
  language: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
}

const CHANNELS = ["IN_APP", "PUSH", "WHATSAPP", "EMAIL", "SMS"];

export default function NotificationTemplatesPage() {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["notification-templates"], queryFn: () => api.get<Template[]>("/notification-templates") });

  const [form, setForm] = useState({ code: "", channel: "IN_APP", language: "en", subjectTemplate: "", bodyTemplate: "" });
  const createTemplate = useMutation({
    mutationFn: () => api.post("/notification-templates", { code: form.code, channel: form.channel, language: form.language, subjectTemplate: form.subjectTemplate || undefined, bodyTemplate: form.bodyTemplate }),
    onSuccess: () => { setForm({ code: "", channel: "IN_APP", language: "en", subjectTemplate: "", bodyTemplate: "" }); setCreating(false); setError(""); void client.invalidateQueries({ queryKey: ["notification-templates"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not create template."),
  });

  const toggleTemplate = useMutation({
    mutationFn: (template: Template) => api.patch(`/notification-templates/${template.id}`, { isActive: !template.isActive }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["notification-templates"] }),
  });

  function submit(event: FormEvent) { event.preventDefault(); setError(""); createTemplate.mutate(); }

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message="Templates could not be loaded." />;

  const templates = query.data ?? [];
  const grouped = CHANNELS.map((channel) => ({ channel, templates: templates.filter((t) => t.channel === channel) })).filter((g) => g.templates.length > 0);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Notifications</span><h1 className="page-title" style={{ marginTop: 6 }}>Message templates</h1><p className="page-subtitle">Manage notification content templates across all delivery channels.</p></div><button className="btn btn-primary" onClick={() => setCreating(!creating)}><Plus size={17} />{creating ? "Cancel" : "Add template"}</button></div>

    {creating && <form className="card" style={{ padding: 20, marginBottom: 18, display: "grid", gap: 14, maxWidth: 600 }} onSubmit={submit}>
      <h3 style={{ margin: 0 }}>New notification template</h3>
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label>Template code</label><input className="input" required maxLength={100} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. ISSUE_ASSIGNED" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="field"><label>Channel</label><select className="input" required value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Language</label><input className="input" required maxLength={10} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value.toLowerCase() })} placeholder="en" /></div>
      </div>
      <div className="field"><label>Subject template <small className="muted">(optional)</small></label><input className="input" maxLength={500} value={form.subjectTemplate} onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })} placeholder="Issue {{issueNumber}} assigned to you" /></div>
      <div className="field"><label>Body template</label><textarea className="input" required rows={4} maxLength={4000} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} placeholder="Use {{variable}} for template interpolation" /></div>
      <button className="btn btn-primary" disabled={createTemplate.isPending}><Plus size={17} />{createTemplate.isPending ? "Creating…" : "Create template"}</button>
    </form>}

    {templates.length === 0 && !creating && <div className="card"><div className="empty" style={{ padding: 40 }}>No notification templates configured yet. Templates define the message content for each delivery channel.</div></div>}

    {grouped.map(({ channel, templates: channelTemplates }) => <section key={channel} className="card" style={{ marginBottom: 18 }}>
      <div className="section-head"><div><h2><FileText size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />{channel.replace(/_/g, " ")}</h2><p>{channelTemplates.length} template{channelTemplates.length !== 1 ? "s" : ""}</p></div></div>
      <table className="data-table"><thead><tr><th>Code</th><th>Language</th><th>Subject</th><th>Version</th><th>Updated</th><th>Status</th></tr></thead><tbody>
        {channelTemplates.map((t) => <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
          <td><code>{t.code}</code></td>
          <td><StatusBadge value={t.language.toUpperCase()} /></td>
          <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subjectTemplate || "—"}</td>
          <td>v{t.version}</td>
          <td className="muted">{new Date(t.updatedAt).toLocaleDateString()}</td>
          <td><button className="icon-button" title={t.isActive ? "Deactivate" : "Activate"} onClick={(e) => { e.stopPropagation(); toggleTemplate.mutate(t); }} disabled={toggleTemplate.isPending} style={{ color: t.isActive ? "var(--success)" : "var(--muted)" }}>{t.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button></td>
        </tr>)}
      </tbody></table>
      {expanded && channelTemplates.find((t) => t.id === expanded) && <div style={{ padding: "16px 20px", background: "var(--surface-1)", borderTop: "1px solid var(--border)", borderRadius: "0 0 12px 12px" }}>
        <strong>Body template:</strong>
        <pre style={{ margin: "8px 0 0", padding: 12, background: "var(--surface-2)", borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{channelTemplates.find((t) => t.id === expanded)!.bodyTemplate}</pre>
      </div>}
    </section>)}
  </>;
}
