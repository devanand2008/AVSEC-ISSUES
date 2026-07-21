"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Database, HardDrive, MessageCircle, Save, XCircle } from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Integrations { whatsapp: { enabled: boolean; configured: boolean }; firebase: { configured: boolean }; objectStorage: { endpoint: string; bucketConfigured: boolean }; automaticDelivery: string }
interface Setting { key: string; value: unknown; version: number; updatedAt: string }

export default function SettingsPage() {
  const { user } = useAuth();
  const integrations = useQuery({ queryKey: ["integration-status"], queryFn: () => api.get<Integrations>("/settings/integrations/status"), enabled: Boolean(user?.permissions.includes("integrations.manage")) });
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: () => api.get<Setting[]>("/settings"), enabled: Boolean(user?.permissions.includes("settings.read")) });
  const items = integrations.data ? [
    { title: "WhatsApp Business Cloud", detail: integrations.data.whatsapp.enabled && integrations.data.whatsapp.configured ? "Automatic issue delivery is enabled." : "Automatic delivery is disabled until valid provider credentials are supplied.", ready: integrations.data.whatsapp.enabled && integrations.data.whatsapp.configured, icon: MessageCircle },
    { title: "Firebase Cloud Messaging", detail: integrations.data.firebase.configured ? "Firebase project credentials and encrypted device registration are configured." : "Push credentials are not configured.", ready: integrations.data.firebase.configured, icon: Cloud },
    { title: "Private object storage", detail: integrations.data.objectStorage.bucketConfigured ? `Storage endpoint: ${integrations.data.objectStorage.endpoint}` : "Object-storage bucket is not configured.", ready: integrations.data.objectStorage.bucketConfigured, icon: HardDrive },
    { title: "PostgreSQL source of truth", detail: "All authoritative application data is persisted transactionally.", ready: true, icon: Database },
  ] : [];
  return <><div className="page-heading"><div><span className="eyebrow">Administration</span><h1 className="page-title" style={{ marginTop: 6 }}>System & integrations</h1><p className="page-subtitle">Credential-safe deployment status and versioned application settings.</p></div></div>
    {integrations.isLoading && <LoadingState />}{integrations.isError && <ErrorState message="Integration status is restricted or unavailable." />}{items.length > 0 && <><div className="integration-grid">{items.map(({ title, detail, ready, icon: Icon }) => <article className="card integration-card" key={title}><span><Icon /></span><div><h2>{title}</h2><p>{detail}</p></div><strong className={ready ? "ready" : "not-ready"}>{ready ? <CheckCircle2 /> : <XCircle />}{ready ? "Ready" : "Setup required"}</strong></article>)}</div><section className="card" style={{ marginTop: 18, padding: 20 }}><h2 style={{ marginTop: 0 }}>Delivery guarantees</h2><p className="muted" style={{ marginBottom: 0 }}>{integrations.data?.automaticDelivery} Provider failures do not delete or roll back issue records.</p></section></>}
    {user?.permissions.includes("settings.read") && <section className="card" style={{ marginTop: 18, padding: 20 }}><div className="section-head" style={{ margin: "-20px -20px 18px" }}><div><h2>Application settings</h2><p>Values are JSON, versioned and audit logged. Secrets are never returned here.</p></div></div>{settings.isLoading ? <LoadingState /> : settings.isError ? <ErrorState /> : settings.data?.length ? <div style={{ display: "grid", gap: 12 }}>{settings.data.map((setting) => <SettingEditor setting={setting} canManage={Boolean(user.permissions.includes("settings.manage"))} key={setting.key} />)}</div> : <div className="empty">No public application settings are configured.</div>}</section>}
  </>;
}

function SettingEditor({ setting, canManage }: { setting: Setting; canManage: boolean }) {
  const client = useQueryClient();
  const [value, setValue] = useState(() => JSON.stringify(setting.value, null, 2));
  const save = useMutation({ mutationFn: async () => api.put(`/settings/${encodeURIComponent(setting.key)}`, { value: JSON.parse(value) as unknown }), onSuccess: () => void client.invalidateQueries({ queryKey: ["app-settings"] }) });
  return <article style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}><div><strong>{setting.key}</strong><small className="muted" style={{ display: "block", marginTop: 3 }}>Version {setting.version} · updated {new Date(setting.updatedAt).toLocaleString()}</small></div>{canManage && <button className="btn" disabled={save.isPending} onClick={() => save.mutate()}><Save size={16} />{save.isPending ? "Saving…" : "Save"}</button>}</div><textarea className="input" rows={Math.min(8, Math.max(2, value.split("\n").length))} value={value} readOnly={!canManage} onChange={(event) => setValue(event.target.value)} />{save.error && <div className="error-box" style={{ marginTop: 8 }}>{save.error instanceof ApiError ? save.error.message : save.error instanceof SyntaxError ? "Enter valid JSON before saving." : "Setting could not be saved."}</div>}</article>;
}

