"use client";

import { ArrowLeft, Image as ImageIcon, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, idempotencyKey } from "@/lib/api";
import type { PageResponse } from "@/lib/types";

const CATEGORIES = [
  "GENERAL", "IMPORTANT", "EMERGENCY", "ACADEMIC", "EXAMINATION", 
  "ATTENDANCE", "EVENT", "PLACEMENT", "HOLIDAY", "DEPARTMENT", 
  "MAINTENANCE", "CIRCULAR", "OTHER"
];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"];

type TargetType =
  | "COLLEGE"
  | "ROLE"
  | "DEPARTMENT"
  | "PROGRAMME"
  | "SECTION"
  | "USER";

interface AudienceOption {
  id: string;
  code?: string;
  name: string;
  departmentId?: string;
  semesterId?: string;
}

interface AudienceOptions {
  departments: AudienceOption[];
  programmes: AudienceOption[];
  sections: AudienceOption[];
}

interface AudienceUser {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  status: string;
}

export default function CreateAnnouncementPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [form, setForm] = useState({
    title: "",
    message: "",
    category: "GENERAL",
    priority: "MEDIUM",
    publishAt: "",
    expiresAt: "",
    showOnAppOpen: true,
    showOnlyOnce: true,
    pinned: false,
    requiresAcknowledgement: false,
    sendPush: false,
    sendEmail: false,
  });

  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("COLLEGE");
  const [targetId, setTargetId] = useState("");
  const [roleCode, setRoleCode] = useState("STUDENT");
  const [confirmSend, setConfirmSend] = useState<{ id: string; count: number } | null>(null);

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<{ code: string; name: string }[]>("/roles"),
  });
  const audienceOptions = useQuery({
    queryKey: ["announcement-audience-options"],
    queryFn: () => api.get<AudienceOptions>("/users/scope-options"),
  });
  const audienceUsers = useQuery({
    queryKey: ["announcement-audience-users"],
    queryFn: () => api.get<PageResponse<AudienceUser>>("/users?pageSize=100&status=ACTIVE"),
    enabled: targetType === "USER",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const audiences =
        targetType === "COLLEGE"
          ? [{ scopeType: "COLLEGE" }]
          : targetType === "ROLE"
            ? [{ scopeType: "COLLEGE", roleCode }]
            : targetType === "USER"
              ? [{ scopeType: "COLLEGE", userId: targetId }]
              : [{ scopeType: targetType, scopeId: targetId }];

      const payload = {
        ...form,
        publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : undefined,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        idempotencyKey: idempotencyKey(),
        audiences,
      };

      const announcement = await api.post<{ id: string }>("/announcements", payload);

      if (image) {
        const presign = await api.post<{ storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>(
          `/announcements/${announcement.id}/image/presign`,
          { fileName: image.name, mimeType: image.type, sizeBytes: image.size }
        );
        
        await api.upload(presign.uploadUrl, image, presign.requiredHeaders);

        const dimensions = await readImageDimensions(image).catch(() => undefined);
        
        await api.post(`/announcements/${announcement.id}/image/complete`, {
          storageKey: presign.storageKey,
          fileName: image.name,
          mimeType: image.type,
          sizeBytes: image.size,
          width: dimensions?.width,
          height: dimensions?.height,
        });
      }

      const recipientCount = await api.get<{ count: number }>(`/announcements/${announcement.id}/recipient-count`);
      return { id: announcement.id, count: recipientCount.count };
    },
    onSuccess: (result) => {
      setConfirmSend(result);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to create announcement");
    }
  });

  const sendMutation = useMutation({
    mutationFn: async (announcementId: string) =>
      api.post(
        `/announcements/${announcementId}/send-all`,
        undefined,
        { "idempotency-key": idempotencyKey() },
      ),
    onSuccess: () => router.push("/admin/announcements"),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to send announcement"),
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be less than 10MB");
      return;
    }
    
    setImage(file);
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  };

  const removeImage = () => {
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.message.trim()) {
      setError("Title and message are required.");
      return;
    }
    if (!["COLLEGE", "ROLE"].includes(targetType) && !targetId) {
      setError("Select a target audience before continuing.");
      return;
    }

    createMutation.mutate();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <Link href="/admin/announcements" className="back-link">
            <ArrowLeft size={16} /> Back to announcements
          </Link>
          <h1 className="page-title" style={{ marginTop: 12 }}>Create Announcement</h1>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      <form onSubmit={handleSubmit} className="card" style={{ padding: 24, maxWidth: 800 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          
          <label className="field">
            <span>Announcement Title *</span>
            <input
              required
              maxLength={180}
              placeholder="E.g., Campus Closure Due to Heavy Rain"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Message Content *</span>
            <textarea
              required
              rows={6}
              maxLength={10000}
              placeholder="Enter the full details of the announcement here..."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
            <div className="muted" style={{ fontSize: "0.8rem", textAlign: "right", marginTop: 4 }}>
              {form.message.length} / 10000 characters
            </div>
          </label>

          <div>
            <span style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Feature Image</span>
            {imagePreview ? (
              <div style={{ position: "relative", width: "fit-content" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Preview" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8 }} />
                <button
                  type="button"
                  className="icon-button"
                  onClick={removeImage}
                  style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: "white" }}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div 
                style={{ border: "2px dashed var(--border)", padding: 40, borderRadius: 8, textAlign: "center", cursor: "pointer" }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (!file) return;
                  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                    setError("Only JPG, PNG, or WebP images are supported.");
                    return;
                  }
                  setImage(file);
                  setImagePreview(URL.createObjectURL(file));
                }}
              >
                <ImageIcon size={32} style={{ color: "var(--muted-color)", margin: "0 auto 12px" }} />
                <strong>Click to upload an image</strong>
                <p className="muted" style={{ margin: 0 }}>JPG, PNG, or WebP (max 10MB)</p>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="select-field">
              <span>Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </select>
            </label>
            <label className="select-field">
              <span>Priority</span>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="field">
              <span>Publish At (Optional)</span>
              <input type="datetime-local" value={form.publishAt} onChange={(e) => setForm({ ...form, publishAt: e.target.value })} />
            </label>
            <label className="field">
              <span>Expires At (Optional)</span>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </label>
          </div>

          <fieldset style={{ border: "1px solid var(--border)", padding: 16, borderRadius: 8 }}>
            <legend style={{ padding: "0 8px", fontWeight: 600 }}>Target Audience</legend>
            <label className="select-field">
              <span>Recipient group</span>
              <select
                value={targetType}
                onChange={(event) => {
                  setTargetType(event.target.value as TargetType);
                  setTargetId("");
                }}
              >
                <option value="COLLEGE">All active college users</option>
                <option value="ROLE">Specific role</option>
                <option value="DEPARTMENT">Specific department</option>
                <option value="PROGRAMME">Specific programme</option>
                <option value="SECTION">Specific class or section</option>
                <option value="USER">Selected user</option>
              </select>
            </label>
            {targetType === "ROLE" && (
              <label className="select-field">
                <span>Role</span>
                <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
                  {roles.data?.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </label>
            )}
            {targetType === "DEPARTMENT" && (
              <AudienceSelect
                label="Department"
                value={targetId}
                items={audienceOptions.data?.departments ?? []}
                onChange={setTargetId}
              />
            )}
            {targetType === "PROGRAMME" && (
              <AudienceSelect
                label="Programme"
                value={targetId}
                items={audienceOptions.data?.programmes ?? []}
                onChange={setTargetId}
              />
            )}
            {targetType === "SECTION" && (
              <AudienceSelect
                label="Class or section"
                value={targetId}
                items={audienceOptions.data?.sections ?? []}
                onChange={setTargetId}
              />
            )}
            {targetType === "USER" && (
              <label className="select-field">
                <span>Active user</span>
                <select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Select an active user</option>
                  {audienceUsers.data?.data.map((item) => (
                    <option key={item.publicId} value={item.publicId}>
                      {item.fullName} ({item.collegeIdentityId})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <fieldset style={{ border: "1px solid var(--border)", padding: 16, borderRadius: 8 }}>
            <legend style={{ padding: "0 8px", fontWeight: 600 }}>Display & Delivery Options</legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.showOnAppOpen} onChange={(e) => setForm({ ...form, showOnAppOpen: e.target.checked })} />
                Auto-display popup on app open
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, opacity: form.showOnAppOpen ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!form.showOnAppOpen} checked={form.showOnlyOnce} onChange={(e) => setForm({ ...form, showOnlyOnce: e.target.checked })} />
                Show only once per user
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.requiresAcknowledgement} onChange={(e) => setForm({ ...form, requiresAcknowledgement: e.target.checked })} />
                Require explicit acknowledgement
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
                Pin to top of list
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.sendPush} onChange={(e) => setForm({ ...form, sendPush: e.target.checked })} />
                Send Push Notification
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />
                Send Email (Important only)
              </label>
            </div>
          </fieldset>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Link href="/admin/announcements" className="btn btn-secondary">Cancel</Link>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
              <Send size={18} />
              {createMutation.isPending ? "Preparing..." : "Send to All Users"}
            </button>
          </div>

        </div>
      </form>

      {confirmSend && (
        <div className="modal-backdrop" role="presentation">
          <div className="card confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="send-announcement-title">
            <h2 id="send-announcement-title" style={{ marginTop: 0 }}>Send this announcement to all active users?</h2>
            <p className="page-subtitle" style={{ margin: "8px 0 0" }}>
              Total recipients: <strong>{confirmSend.count.toLocaleString()}</strong>
            </p>
            <p className="muted">
              The announcement will be displayed automatically when each user opens the application.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
              <button className="btn btn-secondary" type="button" disabled={sendMutation.isPending} onClick={() => setConfirmSend(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={sendMutation.isPending || confirmSend.count === 0}
                onClick={() => sendMutation.mutate(confirmSend.id)}
              >
                <Send size={18} />
                {sendMutation.isPending ? "Sending..." : "Confirm and Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image dimensions could not be read."));
    };
    image.src = url;
  });
}

function AudienceSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: AudienceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select aria-label={label} required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.code ? `${item.code} - ` : ""}{item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
