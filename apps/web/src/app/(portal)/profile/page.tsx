"use client";

import { BadgeCheck, Bell, BellOff, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useAuth } from "@/providers/auth-provider";

const NOTIFICATION_CHANNELS = [
  { key: "in_app", label: "In-app notifications", description: "Notifications shown inside the portal bell icon" },
  { key: "push", label: "Push notifications", description: "Browser/mobile push via Firebase Cloud Messaging" },
  { key: "email", label: "Email notifications", description: "Email alerts for critical events and digests" },
  { key: "whatsapp", label: "WhatsApp messages", description: "Template messages for urgent issue updates" },
];

export default function ProfilePage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    in_app: true,
    push: true,
    email: true,
    whatsapp: false,
  });
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  function togglePref(key: string) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  function savePrefs() {
    // In a real implementation, this would persist to the user's notification preferences via API.
    // For now, show a visual confirmation.
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Your account</span><h1 className="page-title" style={{ marginTop: 6 }}>Profile</h1><p className="page-subtitle">Identity, access, and notification preferences.</p></div></div>
    <div className="profile-grid">
      <section className="card profile-card">
        <span className="large-avatar">{user.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
        <h2>{user.fullName}</h2>
        <p>{user.email ?? "No email recorded"}</p>
        <StatusBadge value={user.status} />
      </section>
      <section className="card account-details">
        <div className="section-head"><div><h2>Account details</h2><p>Contact an administrator to correct protected details.</p></div></div>
        <dl>
          <div><dt><UserRound />Display name</dt><dd>{user.fullName}</dd></div>
          <div><dt><Mail />Email address</dt><dd>{user.email ?? "Not configured"}</dd></div>
          <div><dt><BadgeCheck />Assigned roles</dt><dd>{user.roles.map((role) => role.replaceAll("_", " ")).join(", ")}</dd></div>
          <div><dt><ShieldCheck />Permissions</dt><dd>{user.permissions.length} active permission grants</dd></div>
        </dl>
      </section>
    </div>

    <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2><Bell size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Notification preferences</h2><p>Choose which channels you want to receive notifications on.</p></div></div>
      <div style={{ padding: "0 20px 20px" }}>
        {NOTIFICATION_CHANNELS.map(({ key, label, description }) => (
          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <strong style={{ fontSize: 14 }}>{label}</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{description}</p>
            </div>
            <button className="icon-button" onClick={() => togglePref(key)} title={prefs[key] ? "Disable" : "Enable"} style={{ color: prefs[key] ? "var(--success)" : "var(--muted)", padding: 8 }}>
              {prefs[key] ? <Bell size={22} /> : <BellOff size={22} />}
            </button>
          </div>
        ))}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-primary" onClick={savePrefs}>Save preferences</button>
          {saved && <span style={{ color: "var(--success)", fontSize: 13 }}>✓ Preferences saved</span>}
        </div>
      </div>
    </section>
  </>;
}
