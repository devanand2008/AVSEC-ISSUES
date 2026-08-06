"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowLeft, BookOpen, Building2,
  Calendar, Database, FileText,
  History, Key, Mail, MessageSquare, Phone, RotateCcw,
  Shield, Trash2, User, Users,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { ProfileAvatar } from "@/components/ui/profile-avatar";
import { RoleBadge } from "@/components/ui/role-badge";
import { StatusBadge } from "@/components/status-badge";
import { ArchiveDialog } from "@/components/ui/confirmation-dialog";
import { DependencyDialog, depIcon, type DependencyReport } from "@/components/ui/dependency-dialog";
import { PermanentDeleteDialog } from "@/components/ui/permanent-delete-dialog";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface PersonDetail {
  id: string;
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  whatsappNumber: string | null;
  status: string;
  mustChangePassword: boolean;
  firstLoginCompletedAt: string | null;
  lastLoginAt: string | null;
  archivedAt: string | null;
  roles: Array<{ role: { code: string; name: string }; isPrimary?: boolean }>;
  studentProfile: {
    studentId: string;
    rollNumber: string | null;
    admissionYear: number;
    parentName: string | null;
    parentMobileNumber: string | null;
    emergencyContact: string | null;
    department: { name: string; code: string };
    programme: { name: string; code: string };
    section: { name: string; code: string };
  } | null;
  staffProfile: {
    employeeId: string;
    designation: string | null;
    specialization: string | null;
    department: { name: string; code: string } | null;
  } | null;
}

interface DependencyItem {
  type: string;
  count: number;
}

interface DependencyReportResponse {
  userId: string;
  userName: string;
  collegeIdentityId: string;
  totalRecords: number;
  blockingDependencies: DependencyItem[];
  deletableData: DependencyItem[];
  anonymisableData: DependencyItem[];
}

interface BackupListResponse {
  backups: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt?: string;
  }>;
}

export default function PersonDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"account" | "personal" | "academic" | "history" | "deletion">("account");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canSuspend = user?.permissions.includes("users.suspend") ?? false;
  const canDeletePermanently = user?.permissions.includes("users.delete_permanent") ?? false;
  const canManageBackups = user?.permissions.includes("backups.manage") ?? false;

  const person = useQuery({
    queryKey: ["person", publicId],
    queryFn: () => api.get<PersonDetail>(`/admin/people/${publicId}`),
  });

  const deps = useQuery({
    queryKey: ["people", publicId, "dependencies"],
    queryFn: () => api.get<DependencyReportResponse>(`/admin/people/${publicId}/dependencies`),
    enabled: depOpen || deleteOpen,
  });

  const backups = useQuery({
    queryKey: ["backups", "people-deletion"],
    queryFn: () => api.get<BackupListResponse>("/backups"),
    enabled: canDeletePermanently && canManageBackups,
  });

  const archiveMutation = useMutation({
    mutationFn: (reason: string) => api.patch(`/users/${publicId}/status`, { status: "ARCHIVED", reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["person", publicId] });
      setArchiveOpen(false);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => api.patch(`/users/${publicId}/status`, { status: "ACTIVE", reason: "Restored by admin" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["person", publicId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data: { reason: string; confirmationPhrase: string; backupReference: string }) =>
      api.delete(`/admin/people/${publicId}/permanent`, data),
    onSuccess: () => {
      window.location.href = "/admin/people";
    },
  });

  if (person.isLoading) {
    return (
      <div className="page-container main-with-bottom-nav">
        <LoadingSkeleton variant="card" width="100%" />
      </div>
    );
  }

  if (person.isError || !person.data) {
    return (
      <div className="page-container main-with-bottom-nav">
        <ErrorState message={(person.error as Error)?.message ?? "Person not found"} onRetry={() => void person.refetch()} />
      </div>
    );
  }

  const p = person.data;
  const isStudent = !!p.studentProfile;
  const isArchived = p.status === "ARCHIVED";
  const depReport: DependencyReport | null = deps.data ? {
    userId: deps.data.userId,
    userName: deps.data.userName,
    collegeIdentityId: deps.data.collegeIdentityId,
    totalRecords: deps.data.totalRecords,
    blockingCount: deps.data.blockingDependencies?.length ?? 0,
    categories: [
      { category: "Blocking", icon: depIcon("attendance"), items: deps.data.blockingDependencies.map((item) => ({ label: item.type, count: item.count, action: "preserve" as const })) },
      { category: "Deletable", icon: depIcon("authentication"), items: deps.data.deletableData.map((item) => ({ label: item.type, count: item.count, action: "delete" as const })) },
      { category: "Anonymisable", icon: depIcon("feedback"), items: deps.data.anonymisableData.map((item) => ({ label: item.type, count: item.count, action: "anonymise" as const })) },
    ].filter((c) => c.items.length > 0),
  } : null;
  const verifiedBackup = backups.data?.backups.find((backup) =>
    ["COMPLETED", "RESTORE_TESTED"].includes(backup.status),
  );

  return (
    <div className="page-container main-with-bottom-nav">
      <div style={{ marginBottom: "var(--space-4)" }}>
        <Link href="/admin/people" className="avs-btn avs-btn-ghost avs-btn-sm" style={{ display: "inline-flex", gap: 6 }}>
          <ArrowLeft size={16} /> Back to People
        </Link>
      </div>

      {/* Header Profile Card */}
      <div className="avs-card" style={{ padding: "var(--space-6)", marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start", flexWrap: "wrap" }}>
          <ProfileAvatar name={p.fullName} size="xl" status={p.status === "ACTIVE" ? "active" : p.status === "ARCHIVED" ? "archived" : "pending"} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700, margin: 0 }}>{p.fullName}</h1>
              <StatusBadge value={p.status} />
            </div>
            <p style={{ color: "var(--avs-text-muted)", fontSize: "var(--text-sm)", margin: "4px 0 12px" }}>
              ID: {p.collegeIdentityId} • {p.email ?? "No official email"}
            </p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {p.roles.map((r, i) => (
                <RoleBadge key={i} code={r.role.code} name={r.role.name} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {canSuspend && !isArchived && (
              <button className="avs-btn avs-btn-secondary" onClick={() => setArchiveOpen(true)} type="button">
                <Archive size={16} /> Archive
              </button>
            )}
            {canSuspend && isArchived && (
              <button className="avs-btn avs-btn-secondary" onClick={() => restoreMutation.mutate()} type="button">
                <RotateCcw size={16} /> Restore
              </button>
            )}
            {canDeletePermanently && isArchived && (
              <button className="avs-btn avs-btn-danger-outline" onClick={() => setDepOpen(true)} type="button">
                <Database size={16} /> Dependencies
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="avs-tabs" style={{ marginBottom: "var(--space-6)" }}>
        <button className={`avs-tab ${activeTab === "account" ? "active" : ""}`} onClick={() => setActiveTab("account")} type="button">
          Account Info
        </button>
        <button className={`avs-tab ${activeTab === "personal" ? "active" : ""}`} onClick={() => setActiveTab("personal")} type="button">
          Personal Info
        </button>
        <button className={`avs-tab ${activeTab === "academic" ? "active" : ""}`} onClick={() => setActiveTab("academic")} type="button">
          Academic / Employment
        </button>
        <button className={`avs-tab ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")} type="button">
          History & Audit
        </button>
        <button className={`avs-tab ${activeTab === "deletion" ? "active" : ""}`} onClick={() => setActiveTab("deletion")} type="button">
          Lifecycle & Deletion
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "account" && (
        <div className="grid grid-auto-fit gap-4">
          <DetailTile label="College Identity ID" value={p.collegeIdentityId} icon={<Shield size={16} />} />
          <DetailTile label="Official Email" value={p.email ?? "Not assigned"} icon={<Mail size={16} />} />
          <DetailTile label="Mobile Number" value={p.mobile ?? "Not provided"} icon={<Phone size={16} />} />
          <DetailTile label="WhatsApp Number" value={p.whatsappNumber ?? "Not provided"} icon={<MessageSquare size={16} />} />
          <DetailTile label="Last Login" value={p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString() : "Never"} icon={<History size={16} />} />
          <DetailTile label="Password Change Required" value={p.mustChangePassword ? "Yes" : "No"} icon={<Key size={16} />} />
        </div>
      )}

      {activeTab === "personal" && (
        <div className="grid grid-auto-fit gap-4">
          <DetailTile label="Full Name" value={p.fullName} icon={<User size={16} />} />
          <DetailTile label="Guardian Name" value={p.studentProfile?.parentName ?? "N/A"} icon={<Users size={16} />} />
          <DetailTile label="Guardian Mobile" value={p.studentProfile?.parentMobileNumber ?? "N/A"} icon={<Phone size={16} />} />
          <DetailTile label="Emergency Contact" value={p.studentProfile?.emergencyContact ?? "N/A"} icon={<Phone size={16} />} />
        </div>
      )}

      {activeTab === "academic" && (
        <div className="grid grid-auto-fit gap-4">
          {isStudent && (
            <>
              <DetailTile label="Student ID" value={p.studentProfile!.studentId} icon={<User size={16} />} />
              <DetailTile label="Roll Number" value={p.studentProfile!.rollNumber ?? "N/A"} icon={<FileText size={16} />} />
              <DetailTile label="Admission Year" value={String(p.studentProfile!.admissionYear)} icon={<Calendar size={16} />} />
              <DetailTile label="Department" value={p.studentProfile!.department.name} icon={<Building2 size={16} />} />
              <DetailTile label="Programme" value={p.studentProfile!.programme.name} icon={<BookOpen size={16} />} />
              <DetailTile label="Section" value={p.studentProfile!.section.name} icon={<Users size={16} />} />
            </>
          )}
          {!isStudent && p.staffProfile && (
            <>
              <DetailTile label="Employee ID" value={p.staffProfile.employeeId} icon={<User size={16} />} />
              <DetailTile label="Designation" value={p.staffProfile.designation ?? "Staff"} icon={<FileText size={16} />} />
              <DetailTile label="Specialization" value={p.staffProfile.specialization ?? "General"} icon={<BookOpen size={16} />} />
              <DetailTile label="Department" value={p.staffProfile.department?.name ?? "General"} icon={<Building2 size={16} />} />
            </>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="avs-card" style={{ padding: "var(--space-5)" }}>
          <h3 className="heading-5" style={{ marginBottom: "var(--space-3)" }}>Account Activity Timeline</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--avs-text-muted)" }}>
              First login: {p.firstLoginCompletedAt ? new Date(p.firstLoginCompletedAt).toLocaleString() : "Pending"}
            </div>
            {p.archivedAt && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--avs-warning-dark)" }}>
                Archived on: {new Date(p.archivedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "deletion" && (
        <div className="avs-card" style={{ padding: "var(--space-6)" }}>
          <h3 className="heading-4" style={{ marginBottom: "var(--space-2)" }}>Data Lifecycle Controls</h3>
          <p style={{ color: "var(--avs-text-muted)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
            Manage user lifecycle state (Suspend, Archive, Restore, Dependency Analysis, Permanent Delete).
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ padding: "var(--space-4)", background: "var(--avs-page-alt)", borderRadius: "var(--radius-md)" }}>
              <h4 style={{ fontWeight: 600, fontSize: "var(--text-sm)", margin: "0 0 4px" }}>Archive State</h4>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--avs-text-muted)", margin: 0 }}>
                Status: <strong>{p.status}</strong>. Archiving blocks login while preserving attendance and issue records.
              </p>
            </div>

            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              {!isArchived && canSuspend && (
                <button className="avs-btn avs-btn-warning" onClick={() => setArchiveOpen(true)} type="button">
                  <Archive size={16} /> Archive Account
                </button>
              )}
              {isArchived && (
                <>
                  <button className="avs-btn avs-btn-secondary" onClick={() => restoreMutation.mutate()} type="button">
                    <RotateCcw size={16} /> Restore Account
                  </button>
                  <button className="avs-btn avs-btn-secondary" onClick={() => setDepOpen(true)} type="button">
                    <Database size={16} /> View Dependency Analysis
                  </button>
                  {canDeletePermanently && (
                    <button className="avs-btn avs-btn-danger" onClick={() => setDeleteOpen(true)} type="button">
                      <Trash2 size={16} /> Permanently Delete Student Data
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <ArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={(reason) => archiveMutation.mutate(reason)}
        userName={p.fullName}
        loading={archiveMutation.isPending}
      />

      <DependencyDialog
        open={depOpen}
        onClose={() => setDepOpen(false)}
        onProceed={() => { setDepOpen(false); setDeleteOpen(true); }}
        report={depReport}
        loading={deps.isLoading}
        error={deps.isError ? (deps.error as Error)?.message : undefined}
      />

      <PermanentDeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDelete={(data) => deleteMutation.mutate(data)}
        userName={p.fullName}
        collegeIdentityId={p.collegeIdentityId}
        accountStatus={p.status}
        dependencyCount={deps.data?.totalRecords ?? 0}
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

function DetailTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="avs-card-flat" style={{ padding: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--avs-text-muted)", fontSize: "var(--text-xs)", marginBottom: 4 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--avs-text)" }}>{value}</div>
    </div>
  );
}
