"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Pin } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AnnouncementModal } from "@/components/announcement-modal";

interface Announcement {
  id: string;
  title: string | null;
  message: string;
  category: string;
  priority: string;
  pinned: boolean;
  requiresAcknowledgement: boolean;
  publishAt: string;
  expiresAt: string | null;
  imageUrl?: string | null;
  author: { fullName: string };
  reads: Array<{
    readAt: string | null;
    acknowledgedAt: string | null;
    firstViewedAt: string | null;
    firstDisplayedAt: string | null;
    deliveryStatus: string;
  }>;
}

const TABS = ["NEW", "IMPORTANT", "ALL", "READ", "UNREAD", "EXPIRED", "PINNED"];

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  GENERAL: { bg: "#eff6ff", color: "#2563eb" },
  ACADEMIC: { bg: "#f0fdf4", color: "#16a34a" },
  EXAM: { bg: "#fef3c7", color: "#d97706" },
  PLACEMENT: { bg: "#fae8ff", color: "#a855f7" },
  EVENT: { bg: "#ecfdf5", color: "#059669" },
  EMERGENCY: { bg: "#fef2f2", color: "#dc2626" },
  HOLIDAY: { bg: "#fefce8", color: "#ca8a04" },
  DEPARTMENT: { bg: "#eff6ff", color: "#1d4ed8" },
  TRANSPORT: { bg: "#f0f9ff", color: "#0284c7" },
  OTHER: { bg: "#f1f5f9", color: "#475569" },
};

export default function AnnouncementsPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState("ALL");
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const query = useQuery({
    queryKey: ["announcements"],
    queryFn: () => api.get<Announcement[]>("/announcements"),
  });

  const markOpen = useMutation({
    mutationFn: (id: string) => api.post(`/announcements/${id}/open`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const handleOpen = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement);
    markOpen.mutate(announcement.id);
  };

  const filtered = query.data?.filter((item) => {
    const isUnread = !item.reads[0]?.firstViewedAt;
    const expired = item.expiresAt ? new Date(item.expiresAt) <= new Date() : false;
    if (tab === "NEW") return isUnread;
    if (tab === "UNREAD") return isUnread;
    if (tab === "PINNED") return item.pinned;
    if (tab === "IMPORTANT") return ["EMERGENCY", "CRITICAL", "HIGH"].includes(item.priority);
    if (tab === "READ") return !isUnread;
    if (tab === "EXPIRED") return expired;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Official updates for your assigned college groups."
        breadcrumbs={[{ label: "College Bulletin" }]}
      />

      <div className="card announcement-tabs" style={{ display: "flex", gap: 10, padding: "12px 16px", marginBottom: 16, overflowX: "auto" }}>
        {TABS.map((item) => (
          <button
            key={item}
            className={`btn ${tab === item ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(item)}
            style={{ borderRadius: 20, whiteSpace: "nowrap" }}
          >
            {item.charAt(0) + item.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !filtered?.length ? (
        <EmptyState title={`No ${tab !== "ALL" ? tab.toLowerCase() : ""} announcements`} />
      ) : (
        <div className="announcement-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {filtered.map((item) => {
            const receipt = item.reads[0];
            const isUnread = !receipt?.firstViewedAt;
            return (
              <article
                className="card announcement-card"
                key={item.id}
                onClick={() => handleOpen(item)}
                style={{ cursor: "pointer", display: "flex", flexDirection: "column", overflow: "hidden" }}
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="Announcement feature" style={{ width: "100%", height: 160, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: 120, backgroundColor: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ImageIcon size={32} color="var(--muted-color)" />
                  </div>
                )}
                <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column" }}>
                  <header style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div 
                          className="announcement-category-chip" 
                          style={{
                            background: CATEGORY_COLORS[item.category]?.bg || "var(--border)",
                            color: CATEGORY_COLORS[item.category]?.color || "var(--text)",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "0.75rem",
                            fontWeight: 600
                          }}
                        >
                          {item.category.replace("_", " ")}
                        </div>
                        <StatusBadge value={item.priority} />
                      </div>
                      {item.pinned && <Pin size={16} color="var(--primary)" />}
                    </div>
                    <h2 className="announcement-title" style={{ fontSize: "1.1rem", margin: 0, fontWeight: 700 }}>{item.title?.trim() || "Announcement"}</h2>
                    <span className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: 4 }}>
                      {new Date(item.publishAt).toLocaleDateString()} - {item.author.fullName}
                    </span>
                    {item.expiresAt && (
                      <span className="muted" style={{ fontSize: "0.78rem", display: "block", marginTop: 4 }}>
                        Expires {new Date(item.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </header>
                  <p className="muted" style={{ fontSize: "0.9rem", margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {item.message}
                  </p>
                  <footer style={{ marginTop: "auto", paddingTop: 16, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {isUnread ? (
                      <span style={{ color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600 }}>Unread</span>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.85rem" }}>Read</span>
                    )}
                    {item.requiresAcknowledgement && (
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {receipt?.acknowledgedAt ? "Acknowledged" : "Not acknowledged"}
                      </span>
                    )}
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedAnnouncement && (
        <AnnouncementModal
          announcement={{
            ...selectedAnnouncement,
            imageUrl: selectedAnnouncement.imageUrl ?? undefined,
            receipt: { firstDisplayedAt: selectedAnnouncement.reads[0]?.firstDisplayedAt ?? null },
          }}
          onClose={() => {
            setSelectedAnnouncement(null);
            client.invalidateQueries({ queryKey: ["announcements"] });
          }}
        />
      )}
    </>
  );
}
