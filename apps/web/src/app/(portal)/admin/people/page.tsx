"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ChevronLeft, ChevronRight, Eye,
  RefreshCw, RotateCcw, Search, Shield, Trash2, Upload, UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { ProfileAvatar } from "@/components/ui/profile-avatar";
import { RoleBadge } from "@/components/ui/role-badge";
import { ActionMenu } from "@/components/ui/action-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PeopleListSkeleton } from "@/components/ui/loading-skeleton";
import { FilterButton, FilterBottomSheet } from "@/components/ui/filter-bottom-sheet";
import { ArchiveDialog } from "@/components/ui/confirmation-dialog";
import { DependencyDialog, depIcon, type DependencyReport } from "@/components/ui/dependency-dialog";
import { PermanentDeleteDialog } from "@/components/ui/permanent-delete-dialog";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { PageResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

interface PersonRow {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  mustChangePassword: boolean;
  firstLoginCompletedAt: string | null;
  lastLoginAt: string | null;
  archivedAt: string | null;
  roles: Array<{ role: { code: string; name: string }; isPrimary?: boolean }>;
  studentProfile: {
    studentId: string;
    department: { code: string; name: string };
    section: { code: string; name: string };
  } | null;
  staffProfile: {
    employeeId: string;
    department: { code: string; name: string } | null;
  } | null;
}

interface DependencyReportResponse {
  userId: string;
  userName: string;
  collegeIdentityId: string;
  canPermanentlyDelete: boolean;
  totalRecords: number;
  blockingDependencies: Array<{ type: string; count: number; reason: string }>;
  deletableData: Array<{ type: string; count: number }>;
  anonymisableData: Array<{ type: string; count: number }>;
}

interface BackupListResponse {
  backups: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt?: string;
  }>;
}

/* ═══════════════════════════════════════════════════════════
   Tabs
   ═══════════════════════════════════════════════════════════ */

const TABS = [
  { key: "", label: "All People" },
  { key: "STUDENT", label: "Students" },
  { key: "FACULTY", label: "Faculty" },
  { key: "HOD", label: "HODs" },
  { key: "CLASS_COORDINATOR", label: "Coordinators" },
  { key: "CLASS_REPRESENTATIVE", label: "CRs" },
  { key: "PRINCIPAL", label: "Principal" },
  { key: "VICE_PRINCIPAL", label: "VP" },
  { key: "MAINTENANCE", label: "Maintenance" },
  { key: "ADMIN", label: "Admins" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "ARCHIVED", label: "Archived" },
] as const;

/* ═══════════════════════════════════════════════════════════
   Page Component
   ═══════════════════════════════════════════════════════════ */

export default function PeopleManagementPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── State ──
  const [activeTab, setActiveTab] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  // ── Dialogs ──
  const [archiveTarget, setArchiveTarget] = useState<PersonRow | null>(null);
  const [depTarget, setDepTarget] = useState<PersonRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonRow | null>(null);

  // ── Permissions ──
  const canCreate = user?.permissions.includes("users.create") ?? false;
  const canSuspend = user?.permissions.includes("users.suspend") ?? false;
  const canDeletePermanently = user?.permissions.includes("users.delete_permanent") ?? false;
  const canManageBackups = user?.permissions.includes("backups.manage") ?? false;

  const backups = useQuery({
    queryKey: ["backups", "people-deletion"],
    queryFn: () => api.get<BackupListResponse>("/backups"),
    enabled: canDeletePermanently && canManageBackups,
  });

  // ── Tab → API params mapping ──
  const tabParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (activeTab === "SUSPENDED") params.status = "SUSPENDED";
    else if (activeTab === "ARCHIVED") params.status = "ARCHIVED";
    else if (activeTab === "MAINTENANCE") params.role = "MAINTENANCE_STAFF";
    else if (activeTab === "ADMIN") params.role = "MAIN_ADMIN";
    else if (activeTab) params.role = activeTab;
    return params;
  }, [activeTab]);

  // ── People Query ──
  const people = useQuery({
    queryKey: ["people", search, page, activeTab, roleFilter, statusFilter, deptFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      Object.entries(tabParams).forEach(([k, v]) => params.set(k, v));
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (deptFilter) params.set("departmentId", deptFilter);
      return api.get<PageResponse<PersonRow>>(`/users?${params}`);
    },
  });

  // ── Dependency Query ──
  const deps = useQuery({
    queryKey: ["people", depTarget?.publicId, "dependencies"],
    queryFn: () => api.get<DependencyReportResponse>(`/admin/people/${depTarget!.publicId}/dependencies`),
    enabled: !!depTarget,
  });

  // ── Archive Mutation ──
  const archiveMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"; reason: string }) =>
      api.patch(`/users/${id}/status`, { status, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      setArchiveTarget(null);
    },
  });

  // ── Permanent Delete Mutation ──
  const deleteMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { reason: string; confirmationPhrase: string; backupReference: string } }) =>
      api.delete(`/admin/people/${id}/permanent`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      setDeleteTarget(null);
    },
  });

  // ── Helper: primary role ──
  function primaryRole(p: PersonRow): string {
    const primary = p.roles.find((r) => r.isPrimary);
    return primary?.role.code ?? p.roles[0]?.role.code ?? "UNKNOWN";
  }

  // ── Helper: department info ──
  function deptInfo(p: PersonRow): string {
    if (p.studentProfile) return p.studentProfile.department.name;
    if (p.staffProfile?.department) return p.staffProfile.department.name;
    return "—";
  }

  // ── Helper: section info ──
  function sectionInfo(p: PersonRow): string {
    if (p.studentProfile) return p.studentProfile.section.name;
    return "—";
  }

  // ── Helper: ID info ──
  function idInfo(p: PersonRow): string {
    if (p.studentProfile) return p.studentProfile.studentId;
    if (p.staffProfile) return p.staffProfile.employeeId;
    return p.collegeIdentityId;
  }

  // ── Helper: status for avatar ──
  function avatarStatus(s: string): "active" | "suspended" | "archived" | "pending" {
    if (s === "ACTIVE") return "active";
    if (s === "SUSPENDED") return "suspended";
    if (s === "ARCHIVED") return "archived";
    return "pending";
  }

  // ── Build action menu items ──
  function actions(p: PersonRow) {
    const items = [
      {
        label: "View Profile",
        icon: <Eye size={16} />,
        onClick: () => {
          window.location.href = `/admin/people/${p.publicId}`;
        },
      },
    ];

    if (canSuspend && p.status === "ACTIVE") {
      items.push({
        label: "Suspend Account",
        icon: <Shield size={16} />,
        onClick: () => archiveMutation.mutate({ id: p.publicId, status: "SUSPENDED", reason: "Suspended by admin" }),
      });
    }
    if (canSuspend && p.status !== "ARCHIVED") {
      items.push({
        label: "Archive",
        icon: <Archive size={16} />,
        onClick: () => setArchiveTarget(p),
      });
    }
    if (canSuspend && p.status === "ARCHIVED") {
      items.push({
        label: "Restore",
        icon: <RotateCcw size={16} />,
        onClick: () => archiveMutation.mutate({ id: p.publicId, status: "ACTIVE", reason: "Restored by admin" }),
      });
    }
    if (canDeletePermanently && p.status === "ARCHIVED") {
      items.push({
        label: "View Dependencies",
        icon: <Search size={16} />,
        onClick: () => setDepTarget(p),
      });
    }

    const dangerItems = [];
    if (canDeletePermanently && p.status === "ARCHIVED") {
      dangerItems.push({
        label: "Permanently Delete",
        icon: <Trash2 size={16} />,
        onClick: () => setDeleteTarget(p),
        danger: true as const,
      });
    }

    return [...items, ...dangerItems];
  }

  // ── Active filter count ──
  const activeFilterCount = [roleFilter, statusFilter, deptFilter].filter(Boolean).length;

  // ── Total / pagination ──
  const total = people.data?.meta.total ?? 0;
  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize);
  const verifiedBackup = backups.data?.backups.find((backup) =>
    ["COMPLETED", "RESTORE_TESTED"].includes(backup.status),
  );

  // ── Dependency report → dialog model ──
  const depReport: DependencyReport | null = useMemo(() => {
    if (!deps.data || !depTarget) return null;
    const d = deps.data;
    return {
      userId: d.userId,
      userName: d.userName,
      collegeIdentityId: d.collegeIdentityId,
      totalRecords: d.totalRecords,
      blockingCount: d.blockingDependencies.length,
      categories: [
        {
          category: "Blocking Dependencies",
          icon: depIcon("attendance"),
          items: d.blockingDependencies.map((b) => ({
            label: b.type.replace(/_/g, " "),
            count: b.count,
            action: "preserve" as const,
          })),
        },
        {
          category: "Deletable Records",
          icon: depIcon("authentication"),
          items: d.deletableData.map((b) => ({
            label: b.type.replace(/_/g, " "),
            count: b.count,
            action: "delete" as const,
          })),
        },
        {
          category: "Anonymisable Records",
          icon: depIcon("feedback"),
          items: d.anonymisableData.map((b) => ({
            label: b.type.replace(/_/g, " "),
            count: b.count,
            action: "anonymise" as const,
          })),
        },
      ].filter((c) => c.items.length > 0),
    };
  }, [deps.data, depTarget]);

  return (
    <div className="page-container main-with-bottom-nav">
      {/* ── Header ── */}
      <PageHeader
        title="People Management"
        description="Manage Students, Faculty, Administrators and Maintenance Staff."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "People" }]}
        actions={
          <>
            {canCreate && (
              <Link href="/admin/people/new" className="avs-btn avs-btn-primary">
                <UserPlus size={16} />
                <span className="hide-mobile">Add Person</span>
              </Link>
            )}
            <Link href="/admin/imports" className="avs-btn avs-btn-secondary hide-mobile">
              <Upload size={16} /> Import
            </Link>
          </>
        }
      />

      {/* ── Tabs ── */}
      <div className="avs-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className="avs-tab"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => { setActiveTab(tab.key); setPage(1); }}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Search & Filters Bar ── */}
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search by name, email, ID, mobile…"
          />
        </div>
        <FilterButton onClick={() => setShowFilters(!showFilters)} activeCount={activeFilterCount} />
        <button className="avs-btn avs-btn-ghost avs-btn-icon" onClick={() => void people.refetch()} aria-label="Refresh" type="button">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* ── Filters ── */}
      <FilterBottomSheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        activeCount={activeFilterCount}
        onReset={() => { setRoleFilter(""); setStatusFilter(""); setDeptFilter(""); }}
      >
        <div>
          <label className="avs-label" htmlFor="filter-role">Role</label>
          <select id="filter-role" className="avs-input avs-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="STUDENT">Student</option>
            <option value="FACULTY">Faculty</option>
            <option value="HOD">HOD</option>
            <option value="CLASS_COORDINATOR">Class Coordinator</option>
            <option value="MAIN_ADMIN">Admin</option>
          </select>
        </div>
        <div>
          <label className="avs-label" htmlFor="filter-status">Account Status</label>
          <select id="filter-status" className="avs-input avs-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ARCHIVED">Archived</option>
            <option value="GRADUATED">Graduated</option>
          </select>
        </div>
        <div>
          <label className="avs-label" htmlFor="filter-dept">Department</label>
          <select id="filter-dept" className="avs-input avs-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
          </select>
        </div>
      </FilterBottomSheet>

      {/* ── Content ── */}
      {people.isLoading && <PeopleListSkeleton />}

      {people.isError && (
        <ErrorState
          message={(people.error as Error)?.message}
          onRetry={() => void people.refetch()}
        />
      )}

      {people.isSuccess && people.data.data.length === 0 && (
        <EmptyState
          preset={search ? "no-results" : "no-people"}
          title={search ? "No results found" : "No people yet"}
          description={search ? `No results for "${search}". Try a different search.` : "Add students and staff to get started."}
          action={
            !search && canCreate ? (
              <Link href="/admin/people/new" className="avs-btn avs-btn-primary">
                <UserPlus size={16} /> Add Person
              </Link>
            ) : undefined
          }
        />
      )}

      {people.isSuccess && people.data.data.length > 0 && (
        <>
          {/* ── Desktop Table ── */}
          <div className="avs-table-responsive">
            <div className="avs-table-wrap">
              <table className="avs-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="hide-tablet">Email</th>
                    <th>ID</th>
                    <th>Role</th>
                    <th className="hide-tablet">Department</th>
                    <th className="hide-tablet">Section</th>
                    <th>Status</th>
                    <th className="hide-tablet">Last Login</th>
                    <th style={{ width: 48 }}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.data.data.map((p) => (
                    <tr key={p.publicId}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                          <ProfileAvatar name={p.fullName} size="sm" status={avatarStatus(p.status)} />
                          <div>
                            <div className="font-medium truncate" style={{ maxWidth: 200 }}>{p.fullName}</div>
                            <div className="caption truncate" style={{ maxWidth: 200 }}>{idInfo(p)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hide-tablet">
                        <span className="body-text-sm truncate" style={{ maxWidth: 200, display: "block" }}>{p.email ?? "—"}</span>
                      </td>
                      <td>
                        <span className="caption">{p.collegeIdentityId}</span>
                      </td>
                      <td>
                        <RoleBadge code={primaryRole(p)} />
                      </td>
                      <td className="hide-tablet">
                        <span className="body-text-sm">{deptInfo(p)}</span>
                      </td>
                      <td className="hide-tablet">
                        <span className="body-text-sm">{sectionInfo(p)}</span>
                      </td>
                      <td>
                        <StatusBadge value={p.status} />
                      </td>
                      <td className="hide-tablet">
                        <span className="caption">
                          {p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleDateString() : "Never"}
                        </span>
                      </td>
                      <td>
                        <ActionMenu items={actions(p)} id={`actions-${p.publicId}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="avs-cards-responsive">
            {people.data.data.map((p) => (
              <div key={p.publicId} className="avs-entity-card">
                <ProfileAvatar name={p.fullName} status={avatarStatus(p.status)} />
                <div className="avs-entity-card-body">
                  <div className="avs-entity-card-name">{p.fullName}</div>
                  <div className="avs-entity-card-meta">
                    <span>{p.collegeIdentityId}</span>
                    <RoleBadge code={primaryRole(p)} />
                  </div>
                  <div className="avs-entity-card-meta">
                    <span>{deptInfo(p)}</span>
                    {sectionInfo(p) !== "—" && <span>{sectionInfo(p)}</span>}
                  </div>
                  <div style={{ marginTop: "var(--space-1)" }}>
                    <StatusBadge value={p.status} />
                  </div>
                </div>
                <div className="avs-entity-card-actions">
                  <a href={`/admin/people/${p.publicId}`} className="avs-btn avs-btn-ghost avs-btn-sm">
                    <Eye size={14} />
                  </a>
                  <ActionMenu items={actions(p)} />
                </div>
              </div>
            ))}
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="avs-pagination">
              <span>
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </span>
              <div className="avs-pagination-controls">
                <button className="avs-pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <button key={p} className={`avs-pagination-btn ${p === page ? "active" : ""}`} onClick={() => setPage(p)} type="button">
                      {p}
                    </button>
                  );
                })}
                <button className="avs-pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)} type="button">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Archive Dialog ── */}
      <ArchiveDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={(reason) => {
          if (archiveTarget) {
            archiveMutation.mutate({ id: archiveTarget.publicId, status: "ARCHIVED", reason });
          }
        }}
        userName={archiveTarget?.fullName ?? ""}
        loading={archiveMutation.isPending}
      />

      {/* ── Dependency Dialog ── */}
      <DependencyDialog
        open={!!depTarget}
        onClose={() => setDepTarget(null)}
        onProceed={() => {
          if (depTarget) {
            setDeleteTarget(depTarget);
            setDepTarget(null);
          }
        }}
        report={depReport}
        loading={deps.isLoading}
        error={deps.isError ? (deps.error as Error)?.message : undefined}
      />

      {/* ── Permanent Delete Dialog ── */}
      <PermanentDeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={(data) => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.publicId, data });
          }
        }}
        userName={deleteTarget?.fullName ?? ""}
        collegeIdentityId={deleteTarget?.collegeIdentityId ?? ""}
        accountStatus={deleteTarget?.status ?? ""}
        dependencyCount={depReport?.totalRecords ?? 0}
        backupStatus={{
          available: Boolean(verifiedBackup),
          reference: verifiedBackup?.id,
          createdAt: verifiedBackup?.completedAt ?? verifiedBackup?.createdAt,
        }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
