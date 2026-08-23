"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowLeft, BookOpen, Building2,
  Calendar, Database, FileText,
  History, Key, Mail, MessageSquare, Phone, RotateCcw,
  Pencil, Shield, Trash2, User, Users,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { ProfileAvatar } from "@/components/ui/profile-avatar";
import { RoleBadge } from "@/components/ui/role-badge";
import { StatusBadge } from "@/components/status-badge";
import { ArchiveDialog, ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DependencyDialog, depIcon, type DependencyReport } from "@/components/ui/dependency-dialog";
import { PermanentDeleteDialog } from "@/components/ui/permanent-delete-dialog";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import {
  PEOPLE_BACKUPS_ENDPOINT,
  isRestoreTestedPreDeletionBackup,
} from "@/features/people/people-api";
import { StudentSectionMove } from "@/features/people/student-section-move";
import { StaffFeedbackQrPanel } from "@/features/people/staff-feedback-qr";
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
  roles: Array<{ roleId: string; role: { code: string; name: string }; isPrimary?: boolean }>;
  scopes: Array<{ scopeType: string; scopeId: string | null; issueCategoryId: string | null }>;
  studentProfile: {
    departmentId: string;
    programmeId: string;
    sectionId: string;
    studentId: string;
    registerNumber: string | null;
    rollNumber: string | null;
    studyYear: number | null;
    dateOfBirth: string | null;
    gender: string | null;
    admissionYear: number;
    parentName: string | null;
    parentMobileNumber: string | null;
    emergencyContact: string | null;
    department: { name: string; code: string };
    programme: { name: string; code: string };
    section: {
      id: string;
      name: string;
      code: string;
      semesterId: string;
      studyYear: number | null;
      assignedRoom: {
        id: string;
        code: string;
        name: string;
        roomNumber: string | null;
      } | null;
    };
  } | null;
  staffProfile: {
    departmentId: string | null;
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
    backupType: string;
    createdAt: string;
    completedAt?: string;
    lastRestoreTest?: { status: string };
  }>;
}

interface AvailableRole {
  code: string;
  name: string;
  description: string | null;
}

interface PeopleFilterOptions {
  departments: Array<{ id: string; code: string; name: string }>;
}

export default function PersonDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"account" | "personal" | "academic" | "history" | "deletion">("account");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState("");
  const [editForm, setEditForm] = useState({
    fullName: "",
    collegeIdentityId: "",
    email: "",
    mobile: "",
    departmentId: "",
  });

  const canSuspend = user?.permissions.includes("users.suspend") ?? false;
  const canEdit = user?.permissions.includes("users.update") ?? false;
  const canManageRoles = Boolean(
    user?.permissions.includes("roles.manage") &&
      user.permissions.includes("scopes.manage") &&
      user.permissions.includes("roles.read"),
  );
  const canManageAcademic =
    user?.permissions.includes("academic.manage") ?? false;
  const canDeletePermanently = user?.permissions.includes("users.delete_permanent") ?? false;
  const canManageBackups = user?.permissions.includes("backups.manage") ?? false;
  const canManageFeedbackQr = Boolean(
    user?.permissions.includes("feedback.qr.manage")
      && user.permissions.includes("feedback.targets.manage"),
  );
  const canDownloadFeedbackQr = user?.permissions.includes("feedback.qr.download") ?? false;

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
    queryFn: () => api.get<BackupListResponse>(PEOPLE_BACKUPS_ENDPOINT),
    enabled: canDeletePermanently && canManageBackups,
  });

  const availableRoles = useQuery({
    queryKey: ["roles", "people-editor"],
    queryFn: () => api.get<AvailableRole[]>("/roles"),
    enabled: rolesOpen && canManageRoles,
  });

  const departmentOptions = useQuery({
    queryKey: ["people", "filter-options", "staff-editor"],
    queryFn: () =>
      api.get<PeopleFilterOptions>("/admin/people/filter-options"),
    enabled: editOpen && Boolean(person.data?.staffProfile),
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

  const editMutation = useMutation({
    mutationFn: () => {
      const target = person.data;
      const currentDepartmentId = target?.staffProfile?.departmentId ?? "";
      return api.patch(`/admin/people/${publicId}`, {
        fullName: editForm.fullName.trim(),
        collegeIdentityId: editForm.collegeIdentityId.trim(),
        email: editForm.email.trim() || null,
        mobile: editForm.mobile.trim() || null,
        ...(target?.staffProfile &&
        editForm.departmentId !== currentDepartmentId
          ? { departmentId: editForm.departmentId || null }
          : {}),
      });
    },
    onSuccess: () => {
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["person", publicId] });
      void queryClient.invalidateQueries({ queryKey: ["people"] });
    },
  });

  const rolesMutation = useMutation({
    mutationFn: () => {
      const target = person.data;
      if (!target) throw new Error("Person details are unavailable.");
      return api.patch(`/users/${publicId}/access`, {
        roleCodes: selectedRoleCodes,
        scopes: target.scopes.map((scope) => ({
          type: scope.scopeType,
          ...(scope.scopeId ? { id: scope.scopeId } : {}),
          ...(scope.issueCategoryId
            ? { issueCategoryId: scope.issueCategoryId }
            : {}),
        })),
        reason: roleReason.trim(),
      });
    },
    onSuccess: () => {
      setRolesOpen(false);
      setRoleReason("");
      void queryClient.invalidateQueries({ queryKey: ["person", publicId] });
      void queryClient.invalidateQueries({ queryKey: ["people"] });
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
  const canCleanStudentPermanently =
    isStudent &&
    !p.staffProfile &&
    p.roles.every(({ role }) =>
      ["STUDENT", "CLASS_REPRESENTATIVE"].includes(role.code),
    );
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
    isRestoreTestedPreDeletionBackup(backup, p.archivedAt),
  );

  return (
    <div className="page-container main-with-bottom-nav">
      <div style={{ marginBottom: "var(--space-4)" }}>
        <Link href="/admin/people" className="avs-btn avs-btn-ghost avs-btn-sm" style={{ display: "inline-flex", gap: 6 }}>
          <ArrowLeft size={16} /> Back to People
        </Link>
      </div>

      {restoreMutation.isError && (
        <div className="error-box" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          {personMutationError(restoreMutation.error, "The person could not be restored.")}
        </div>
      )}

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
            {canEdit && !isArchived && (
              <button
                className="avs-btn avs-btn-secondary"
                onClick={() => {
                  editMutation.reset();
                  setEditForm({
                    fullName: p.fullName,
                    collegeIdentityId: p.collegeIdentityId,
                    email: p.email ?? "",
                    mobile: p.mobile ?? "",
                    departmentId: p.staffProfile?.departmentId ?? "",
                  });
                  setEditOpen(true);
                }}
                type="button"
              >
                <Pencil size={16} /> Edit
              </button>
            )}
            {canManageRoles && !isArchived && (
              <button
                className="avs-btn avs-btn-secondary"
                onClick={() => {
                  rolesMutation.reset();
                  setSelectedRoleCodes(p.roles.map((entry) => entry.role.code));
                  setRoleReason("");
                  setRolesOpen(true);
                }}
                type="button"
              >
                <Shield size={16} /> Manage roles
              </button>
            )}
            {canSuspend && !isArchived && (
              <button className="avs-btn avs-btn-secondary" onClick={() => { archiveMutation.reset(); setArchiveOpen(true); }} type="button">
                <Archive size={16} /> Archive
              </button>
            )}
            {canSuspend && isArchived && (
              <button className="avs-btn avs-btn-secondary" onClick={() => { restoreMutation.reset(); restoreMutation.mutate(); }} type="button">
                <RotateCcw size={16} /> Restore
              </button>
            )}
            {canDeletePermanently && isArchived && canCleanStudentPermanently && (
              <button className="avs-btn avs-btn-danger-outline" onClick={() => setDepOpen(true)} type="button">
                <Database size={16} /> Dependencies
              </button>
            )}
          </div>
        </div>
      </div>

      {p.staffProfile && (
        <StaffFeedbackQrPanel
          staffPublicId={p.publicId}
          staffName={p.fullName}
          accountStatus={p.status}
          hasStaffProfile={Boolean(p.staffProfile)}
          canManage={canManageFeedbackQr}
          canDownload={canDownloadFeedbackQr}
        />
      )}

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
        <>
          <div className="grid grid-auto-fit gap-4">
            {isStudent && (
              <>
                <DetailTile label="Student ID" value={p.studentProfile!.studentId} icon={<User size={16} />} />
                <DetailTile label="Register Number" value={p.studentProfile!.registerNumber ?? "N/A"} icon={<FileText size={16} />} />
                <DetailTile label="Internal Roll Number" value={p.studentProfile!.rollNumber ?? "N/A"} icon={<FileText size={16} />} />
                <DetailTile label="Admission Year" value={String(p.studentProfile!.admissionYear)} icon={<Calendar size={16} />} />
                <DetailTile label="Study Year" value={p.studentProfile!.studyYear ? `Year ${p.studentProfile!.studyYear}` : "N/A"} icon={<Calendar size={16} />} />
                <DetailTile label="Department" value={p.studentProfile!.department.name} icon={<Building2 size={16} />} />
                <DetailTile label="Programme" value={p.studentProfile!.programme.name} icon={<BookOpen size={16} />} />
                <DetailTile label="Section" value={p.studentProfile!.section.name} icon={<Users size={16} />} />
                <DetailTile
                  label="Classroom"
                  value={p.studentProfile!.section.assignedRoom
                    ? `${p.studentProfile!.section.assignedRoom!.code} - ${p.studentProfile!.section.assignedRoom!.name}`
                    : "Not assigned"}
                  icon={<Building2 size={16} />}
                />
                <DetailTile label="Gender" value={formatGender(p.studentProfile!.gender)} icon={<User size={16} />} />
                <DetailTile label="Date of Birth" value={formatDate(p.studentProfile!.dateOfBirth)} icon={<Calendar size={16} />} />
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
          {p.studentProfile && canManageAcademic && !isArchived && (
            <StudentSectionMove
              studentPublicId={p.publicId}
              studentName={p.fullName}
              profile={p.studentProfile}
            />
          )}
        </>
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
                <button className="avs-btn avs-btn-warning" onClick={() => { archiveMutation.reset(); setArchiveOpen(true); }} type="button">
                  <Archive size={16} /> Archive Account
                </button>
              )}
              {isArchived && (
                <>
                  <button className="avs-btn avs-btn-secondary" onClick={() => { restoreMutation.reset(); restoreMutation.mutate(); }} type="button">
                    <RotateCcw size={16} /> Restore Account
                  </button>
                  <button className="avs-btn avs-btn-secondary" onClick={() => setDepOpen(true)} type="button">
                    <Database size={16} /> View Dependency Analysis
                  </button>
                  {canDeletePermanently && canCleanStudentPermanently && (
                    <button className="avs-btn avs-btn-danger" onClick={() => { deleteMutation.reset(); setDeleteOpen(true); }} type="button">
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
      <ConfirmationDialog
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          editMutation.reset();
        }}
        onConfirm={() => editMutation.mutate()}
        title="Edit person"
        description={
          p.staffProfile
            ? "Update identity, contact, and staff department details."
            : "Update identity and contact details. Academic placement is managed in the Academic tab."
        }
        confirmLabel="Save changes"
        loading={editMutation.isPending}
        confirmDisabled={
          editForm.fullName.trim().length < 2 ||
          editForm.collegeIdentityId.trim().length < 2 ||
          Boolean(editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) ||
          Boolean(editForm.mobile.trim() && !/^\+?[0-9]{7,15}$/.test(editForm.mobile.trim()))
        }
      >
        <div className="form-grid" style={{ marginTop: "var(--space-4)" }}>
          <label className="field">
            <span>User Name</span>
            <input
              className="input"
              value={editForm.fullName}
              onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })}
              minLength={2}
              maxLength={180}
              required
            />
          </label>
          <label className="field">
            <span>User ID</span>
            <input
              className="input"
              value={editForm.collegeIdentityId}
              onChange={(event) => setEditForm({ ...editForm, collegeIdentityId: event.target.value })}
              minLength={2}
              maxLength={60}
              required
            />
          </label>
          <label className="field">
            <span>Official Email</span>
            <input
              className="input"
              type="email"
              value={editForm.email}
              onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Mobile Number</span>
            <input
              className="input"
              inputMode="tel"
              value={editForm.mobile}
              onChange={(event) => setEditForm({ ...editForm, mobile: event.target.value })}
            />
          </label>
          {p.staffProfile && (
            <label className="field">
              <span>Department</span>
              <select
                className="input"
                value={editForm.departmentId}
                disabled={departmentOptions.isLoading || departmentOptions.isError}
                onChange={(event) =>
                  setEditForm({ ...editForm, departmentId: event.target.value })
                }
              >
                <option value="">General / No department</option>
                {editForm.departmentId &&
                  !departmentOptions.data?.departments.some(
                    (department) => department.id === editForm.departmentId,
                  ) && (
                    <option value={editForm.departmentId}>
                      {p.staffProfile.department
                        ? `${p.staffProfile.department.code} - ${p.staffProfile.department.name}`
                        : "Current department"}
                    </option>
                  )}
                {departmentOptions.data?.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} - {department.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {p.staffProfile && departmentOptions.isLoading && (
            <p className="muted" role="status">Loading departments...</p>
          )}
          {p.staffProfile && departmentOptions.isError && (
            <div className="error-box" role="alert">
              Departments could not be loaded. Close and reopen the editor to try again.
            </div>
          )}
          {editMutation.isError && (
            <div className="error-box" role="alert">
              {(editMutation.error as Error).message}
            </div>
          )}
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={rolesOpen}
        onClose={() => setRolesOpen(false)}
        onConfirm={() => rolesMutation.mutate()}
        title="Manage roles"
        description="Role changes are checked against your backend delegation permissions and revoke active sessions."
        confirmLabel="Save roles"
        loading={rolesMutation.isPending}
        confirmDisabled={
          selectedRoleCodes.length === 0 ||
          roleReason.trim().length < 3 ||
          availableRoles.isLoading ||
          availableRoles.isError
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {availableRoles.isLoading && <p className="muted">Loading roles...</p>}
          {availableRoles.data?.map((role) => (
            <label className="check-field" key={role.code}>
              <input
                type="checkbox"
                checked={selectedRoleCodes.includes(role.code)}
                onChange={(event) =>
                  setSelectedRoleCodes((current) =>
                    event.target.checked
                      ? [...new Set([...current, role.code])]
                      : current.filter((code) => code !== role.code),
                  )
                }
              />
              <span>{role.name}</span>
            </label>
          ))}
          <label className="field">
            <span>Reason for role change</span>
            <textarea
              className="input"
              rows={3}
              minLength={3}
              maxLength={500}
              required
              value={roleReason}
              onChange={(event) => setRoleReason(event.target.value)}
            />
          </label>
          {(availableRoles.isError || rolesMutation.isError) && (
            <div className="error-box" role="alert">
              {rolesMutation.isError
                ? (rolesMutation.error as Error).message
                : "Roles could not be loaded."}
            </div>
          )}
        </div>
      </ConfirmationDialog>

      <ArchiveDialog
        open={archiveOpen}
        onClose={() => { setArchiveOpen(false); archiveMutation.reset(); }}
        onConfirm={(reason) => archiveMutation.mutate(reason)}
        userName={p.fullName}
        loading={archiveMutation.isPending}
        error={archiveMutation.isError ? personMutationError(archiveMutation.error, "The person could not be archived.") : undefined}
      />

      <DependencyDialog
        open={depOpen}
        onClose={() => setDepOpen(false)}
        onProceed={() => { deleteMutation.reset(); setDepOpen(false); setDeleteOpen(true); }}
        report={depReport}
        loading={deps.isLoading}
        error={deps.isError ? (deps.error as Error)?.message : undefined}
      />

      <PermanentDeleteDialog
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); deleteMutation.reset(); }}
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
        error={deleteMutation.isError ? personMutationError(deleteMutation.error, "The person could not be permanently deleted.") : undefined}
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

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleDateString();
}

function formatGender(value: string | null): string {
  if (!value) return "N/A";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function personMutationError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
