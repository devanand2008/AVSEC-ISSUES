"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";

type AdminAnnouncement = {
  id: string;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "PARTIALLY_DELIVERED" | "EXPIRED" | "UNPUBLISHED" | "ARCHIVED" | "FAILED";
  priority: string;
  category: string;
  publishAt: string | null;
  createdAt: string;
  imageUrl: string | null;
  author: { fullName: string };
  _count: { reads: number };
  viewedCount: number;
};

export default function AdminAnnouncementsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const announcements = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => api.get<AdminAnnouncement[]>("/announcements/admin/all"),
  });

  const filtered = announcements.data?.filter((item) => {
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>Announcements</h1>
          <p className="page-subtitle">Manage campus-wide announcements and track read analytics.</p>
        </div>
        <Link href="/admin/announcements/create" className="btn btn-primary">
          <Plus size={18} />
          New Announcement
        </Link>
      </div>

      <div className="card filters">
        <label className="search-field" style={{ flex: 2 }}>
          <Search size={18} />
          <input
            aria-label="Search announcements"
            placeholder="Search by title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="select-field" style={{ flex: 1 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        {announcements.isLoading ? (
          <LoadingState />
        ) : announcements.isError ? (
          <ErrorState message="Could not load announcements." />
        ) : !filtered?.length ? (
          <EmptyState title="No announcements found" />
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title & Category</th>
                  <th>Status</th>
                  <th>Publish Date</th>
                  <th>Author</th>
                  <th>Analytics</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const viewRate = item._count.reads > 0 
                    ? Math.round((item.viewedCount / item._count.reads) * 100) 
                    : 0;
                  
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                          {item.category.replace("_", " ")} · {item.priority}
                        </div>
                      </td>
                      <td>
                        <StatusBadge value={item.status} />
                      </td>
                      <td>
                        {item.publishAt ? new Date(item.publishAt).toLocaleString() : "Not set"}
                      </td>
                      <td>{item.author.fullName}</td>
                      <td>
                        {item.status === "PUBLISHED" || item.status === "ARCHIVED" ? (
                          <div style={{ fontSize: "0.85rem" }}>
                            <strong>{item.viewedCount}</strong> / {item._count.reads} views ({viewRate}%)
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/admin/announcements/${item.id}`} className="btn btn-secondary">
                          View details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
