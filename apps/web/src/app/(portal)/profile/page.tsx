"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Bell, BellOff, Camera, KeyRound, Mail, ShieldCheck, Trash2, UserRound, MapPin, Phone, GraduationCap, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

const NOTIFICATION_CHANNELS = [
  { key: "in_app", label: "In-app notifications", description: "Notifications shown inside the portal bell icon" },
  { key: "push", label: "Push notifications", description: "Browser and mobile push notifications" },
  { key: "email", label: "Email notifications", description: "Email alerts for critical events and digests" },
  { key: "whatsapp", label: "WhatsApp messages", description: "Template messages for urgent issue updates" },
] as const;

type NotificationPreferences = Record<(typeof NOTIFICATION_CHANNELS)[number]["key"], boolean>;

interface Profile {
  fullName: string;
  email: string | null;
  mobile: string | null;
  whatsappNumber: string | null;
  profilePhotoKey: string | null;
  profileCompletionStatus: string;
  profileCompletionPercentage: number;
  profileRejectionReason: string | null;
  notificationPreferences: NotificationPreferences;
  roles: Array<{ role: { code: string; name: string } }>;
  address?: string | null;
  guardianName?: string | null;
  guardianMobile?: string | null;
  emergencyContactName?: string | null;
  emergencyContactNumber?: string | null;
  bloodGroup?: string | null;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app: true,
  push: true,
  email: true,
  whatsapp: false,
};

type Tab = "personal" | "academic" | "contact" | "guardian" | "emergency" | "security";

export default function ProfilePage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preferenceOverrides, setPreferenceOverrides] = useState<Partial<NotificationPreferences>>({});
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("personal");

  const profile = useQuery({
    queryKey: ["profile-me"],
    queryFn: () => api.get<Profile>("/profile/me"),
    enabled: Boolean(user),
  });

  const photo = useQuery({
    queryKey: ["profile-photo"],
    queryFn: () => api.get<{ downloadUrl: string }>("/profile/me/photo"),
    enabled: Boolean(profile.data?.profilePhotoKey),
    retry: false,
  });

  const prefs: NotificationPreferences = {
    ...DEFAULT_PREFERENCES,
    ...profile.data?.notificationPreferences,
    ...preferenceOverrides,
  };

  const savePreferences = useMutation({
    mutationFn: () => api.patch<NotificationPreferences>("/profile/me/notification-preferences", prefs),
    onSuccess: () => {
      setMessage("Preferences saved.");
      setPreferenceOverrides({});
      void client.invalidateQueries({ queryKey: ["profile-me"] });
    },
    onError: (caught) => setMessage(caught instanceof ApiError ? caught.message : "Preferences could not be saved."),
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("Choose a JPEG, PNG, or WebP image.");
      }
      if (file.size > 10 * 1024 * 1024) throw new Error("Profile photo must be 10 MB or smaller.");
      const presign = await api.post<{ storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>("/profile/me/photo", {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      await api.upload(presign.uploadUrl, file, presign.requiredHeaders);
      return api.post("/profile/me/photo/complete", {
        storageKey: presign.storageKey,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
    },
    onSuccess: () => {
      setMessage("Profile photo updated.");
      void client.invalidateQueries({ queryKey: ["profile-me"] });
      void client.invalidateQueries({ queryKey: ["profile-photo"] });
    },
    onError: (caught) => setMessage(caught instanceof Error ? caught.message : "Profile photo could not be uploaded."),
  });

  const removePhoto = useMutation({
    mutationFn: () => api.delete("/profile/me/photo"),
    onSuccess: () => {
      setMessage("Profile photo removed.");
      void client.invalidateQueries({ queryKey: ["profile-me"] });
      void client.removeQueries({ queryKey: ["profile-photo"] });
    },
    onError: (caught) => setMessage(caught instanceof ApiError ? caught.message : "Profile photo could not be removed."),
  });

  if (!user) return null;
  const details = profile.data;
  const initials = user.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "personal", label: "Personal", icon: <UserRound size={16} /> },
    { id: "academic", label: "Academic", icon: <GraduationCap size={16} /> },
    { id: "contact", label: "Contact", icon: <Phone size={16} /> },
    { id: "guardian", label: "Guardian", icon: <ShieldCheck size={16} /> },
    { id: "emergency", label: "Emergency", icon: <AlertCircle size={16} /> },
    { id: "security", label: "Security", icon: <KeyRound size={16} /> },
  ];

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">Your account</span>
        <h1 className="page-title" style={{ marginTop: 6 }}>Profile</h1>
      </div>
      {details?.profileCompletionPercentage !== 100 && (
         <Link className="btn btn-primary" href="/profile/setup">
            Complete Profile
         </Link>
      )}
    </div>
    
    {message && <div className="info-box" role="status" style={{ marginBottom: 16 }}>{message}</div>}

    <div className="profile-layout" style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        
        {/* Left Sidebar: Profile Header Card */}
        <section className="card profile-card" style={{ textAlign: "center", position: "sticky", top: 80 }}>
            {photo.data?.downloadUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.data.downloadUrl} alt={`${user.fullName} profile`} className="large-avatar" style={{ objectFit: "cover", margin: "0 auto 16px" }} />
            ) : <span className="large-avatar" style={{ margin: "0 auto 16px" }}>{initials}</span>}
            <h2 style={{ fontSize: "1.25rem", marginBottom: 4 }}>{user.fullName}</h2>
            <p className="muted" style={{ marginBottom: 12 }}>{details?.roles.map(({ role }) => role.name).join(", ") ?? user.roles.map((role) => role.replaceAll("_", " ")).join(", ")}</p>
            <StatusBadge value={details?.profileCompletionStatus ?? user.status} />
            
            <div style={{ marginTop: 24, padding: "16px 0", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
                 <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                     <span className="muted">Completion</span>
                     <strong>{details?.profileCompletionPercentage ?? 0}%</strong>
                 </div>
                 <div style={{ background: "var(--border)", height: 6, borderRadius: 3, overflow: "hidden" }}>
                     <div style={{ background: "var(--primary)", height: "100%", width: `${details?.profileCompletionPercentage ?? 0}%` }} />
                 </div>
            </div>

            <input
            ref={fileInput}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadPhoto.mutate(file);
                event.target.value = "";
            }}
            />
            <div className="button-row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="btn btn-primary" disabled={uploadPhoto.isPending} onClick={() => fileInput.current?.click()} style={{ width: "100%" }}>
                <Camera size={17} />{uploadPhoto.isPending ? "Uploading…" : "Change photo"}
            </button>
            </div>
            {details?.profilePhotoKey && (
                 <button className="btn btn-secondary" disabled={removePhoto.isPending} onClick={() => removePhoto.mutate()} style={{ width: "100%", marginTop: 8 }}>
                    <Trash2 size={17} />Remove
                </button>
            )}
            <small className="muted" style={{ display: "block", marginTop: 12 }}>JPEG, PNG, or WebP. Max 10 MB.</small>
        </section>

        {/* Right Content Area: Tabs */}
        <div className="profile-tabs-container" style={{ minWidth: 0 }}>
            <div className="tabs" style={{ display: "flex", gap: 8, overflowX: "auto", borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 24 }}>
                {tabs.map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                            borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
                            background: activeTab === tab.id ? "var(--primary-subtle)" : "transparent",
                            color: activeTab === tab.id ? "var(--primary)" : "var(--muted)",
                            fontWeight: activeTab === tab.id ? 600 : 500,
                            whiteSpace: "nowrap"
                        }}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            <section className="card account-details">
                {activeTab === "personal" && (
                    <>
                        <div className="section-head">
                            <div><h2>Personal Information</h2><p>Your basic identity details.</p></div>
                            <Link className="btn btn-secondary" href="/profile/setup">Edit</Link>
                        </div>
                        <dl>
                            <div><dt><UserRound />Full Name</dt><dd>{details?.fullName ?? user.fullName}</dd></div>
                            <div><dt><AlertCircle />Blood Group</dt><dd>{details?.bloodGroup || "Not provided"}</dd></div>
                        </dl>
                        {details?.profileRejectionReason && <div className="error-box" style={{ marginTop: 16 }}>Correction requested: {details.profileRejectionReason}</div>}
                    </>
                )}

                {activeTab === "academic" && (
                    <>
                        <div className="section-head">
                            <div><h2>Academic Information</h2><p>Protected college fields can only be changed by an administrator.</p></div>
                        </div>
                        <dl>
                            <div><dt><BadgeCheck />Assigned roles</dt><dd>{details?.roles.map(({ role }) => role.name).join(", ") ?? user.roles.map((role) => role.replaceAll("_", " ")).join(", ")}</dd></div>
                            <div><dt><Mail />Official email</dt><dd>{details?.email ?? user.email ?? "Not configured"}</dd></div>
                        </dl>
                    </>
                )}

                {activeTab === "contact" && (
                     <>
                        <div className="section-head">
                            <div><h2>Contact Information</h2><p>Your primary communication details.</p></div>
                            <Link className="btn btn-secondary" href="/profile/setup">Edit</Link>
                        </div>
                        <dl>
                            <div><dt><Phone />Mobile Number</dt><dd>{details?.mobile || "Not provided"}</dd></div>
                            <div><dt><Phone />WhatsApp</dt><dd>{details?.whatsappNumber || "Not provided"}</dd></div>
                            <div><dt><MapPin />Address</dt><dd>{details?.address || "Not provided"}</dd></div>
                        </dl>
                    </>
                )}

                {activeTab === "guardian" && (
                     <>
                        <div className="section-head">
                            <div><h2>Guardian Information</h2><p>Details of your primary guardian.</p></div>
                            <Link className="btn btn-secondary" href="/profile/setup">Edit</Link>
                        </div>
                        <dl>
                            <div><dt><UserRound />Guardian Name</dt><dd>{details?.guardianName || "Not provided"}</dd></div>
                            <div><dt><Phone />Guardian Mobile</dt><dd>{details?.guardianMobile || "Not provided"}</dd></div>
                        </dl>
                    </>
                )}

                {activeTab === "emergency" && (
                     <>
                        <div className="section-head">
                            <div><h2>Emergency Contact</h2><p>Who to contact in case of an emergency.</p></div>
                            <Link className="btn btn-secondary" href="/profile/setup">Edit</Link>
                        </div>
                        <dl>
                            <div><dt><UserRound />Contact Name</dt><dd>{details?.emergencyContactName || "Not provided"}</dd></div>
                            <div><dt><Phone />Contact Number</dt><dd>{details?.emergencyContactNumber || "Not provided"}</dd></div>
                        </dl>
                    </>
                )}

                {activeTab === "security" && (
                     <>
                        <div className="section-head">
                            <div><h2>Account Security & Notifications</h2><p>Manage your password and alerts.</p></div>
                            <Link className="btn btn-secondary" href="/change-password"><KeyRound size={17} />Change Password</Link>
                        </div>
                        
                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ fontSize: "1rem", marginBottom: 12 }}><Bell size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Notification preferences</h3>
                            <div style={{ padding: "0" }}>
                                {NOTIFICATION_CHANNELS.map(({ key, label, description }) => (
                                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                                    <div><strong style={{ fontSize: 14 }}>{label}</strong><p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{description}</p></div>
                                    <button className="icon-button" aria-label={`${prefs[key] ? "Disable" : "Enable"} ${label}`} onClick={() => { setPreferenceOverrides((previous) => ({ ...previous, [key]: !prefs[key] })); setMessage(""); }} style={{ color: prefs[key] ? "var(--success)" : "var(--muted)", padding: 8 }}>
                                    {prefs[key] ? <Bell size={22} /> : <BellOff size={22} />}
                                    </button>
                                </div>
                                ))}
                                <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={savePreferences.isPending || profile.isLoading} onClick={() => savePreferences.mutate()}>
                                {savePreferences.isPending ? "Saving…" : "Save preferences"}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    </div>
  </>;
}
