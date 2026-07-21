"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import type { PageResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

interface UserScope {
  scopeType: string;
  scopeId: string | null;
  issueCategoryId: string | null;
}
interface UserRow {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  mustChangePassword: boolean;
  firstLoginCompletedAt: string | null;
  lastLoginAt: string | null;
  roles: Array<{ role: { code: string; name: string }; isPrimary?: boolean }>;
  scopes: UserScope[];
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
interface Role {
  code: string;
  name: string;
  description: string | null;
}
interface Option {
  id: string;
  code?: string;
  name: string;
  departmentId?: string;
  programmeId?: string;
  academicYearId?: string;
  semesterId?: string;
}
interface ScopeOptions {
  college: Option[];
  campuses: Option[];
  departments: Option[];
  programmes: Option[];
  academicYears: Option[];
  semesters: Option[];
  sections: Option[];
  blocks: Option[];
  floors: Option[];
  rooms: Option[];
  issueCategories: Option[];
}
interface ScopeRow {
  type: string;
  targetId: string;
}
interface CreateForm {
  collegeIdentityId: string;
  fullName: string;
  email: string;
  mobile: string;
  whatsappNumber: string;
  temporaryPassword: string;
  accountStatus: string;
  roleCodes: string[];
  scopes: ScopeRow[];
  profileType: "student" | "staff" | "none";
  departmentId: string;
  programmeId: string;
  sectionId: string;
  studentId: string;
  admissionYear: number;
  rollNumber: string;
  employeeId: string;
  designation: string;
}
interface PasswordResetResult {
  id: string;
  loginId: string;
  fullName: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  sessionsRevoked: boolean;
}
interface RoleHistoryEntry {
  id: string;
  previousRoles: string[];
  newRoles: string[];
  previousScopes: unknown;
  newScopes: unknown;
  reason: string;
  changedAt: string;
  changedBy: { publicId: string; fullName: string } | null;
}
interface RoleHistoryResult {
  user: { publicId: string; fullName: string };
  history: RoleHistoryEntry[];
}
const blank: CreateForm = {
  collegeIdentityId: "",
  fullName: "",
  email: "",
  mobile: "",
  whatsappNumber: "",
  temporaryPassword: "",
  accountStatus: "ACTIVE",
  roleCodes: ["STUDENT"],
  scopes: [{ type: "SECTION", targetId: "" }],
  profileType: "student",
  departmentId: "",
  programmeId: "",
  sectionId: "",
  studentId: "",
  admissionYear: new Date().getFullYear(),
  rollNumber: "",
  employeeId: "",
  designation: "",
};
const accountStatuses = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "DISABLED",
  "GRADUATED",
  "RESIGNED",
  "ARCHIVED",
];
const scopeTypes = [
  "COLLEGE",
  "CAMPUS",
  "DEPARTMENT",
  "PROGRAMME",
  "ACADEMIC_YEAR",
  "SEMESTER",
  "SECTION",
  "BLOCK",
  "FLOOR",
  "ROOM",
  "ISSUE_CATEGORY",
  "ASSIGNED_ISSUES",
];
const optionKey: Record<string, keyof ScopeOptions> = {
  COLLEGE: "college",
  CAMPUS: "campuses",
  DEPARTMENT: "departments",
  PROGRAMME: "programmes",
  ACADEMIC_YEAR: "academicYears",
  SEMESTER: "semesters",
  SECTION: "sections",
  BLOCK: "blocks",
  FLOOR: "floors",
  ROOM: "rooms",
  ISSUE_CATEGORY: "issueCategories",
};
const scopeOptions = scopeTypes.map((type) => ({
  type,
  label: type
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" "),
}));

export default function UsersAdminPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [firstLoginFilter, setFirstLoginFilter] = useState("");
  const [mode, setMode] = useState<"create" | "access" | "assign-role" | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [form, setForm] = useState<CreateForm>(blank);
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const [access, setAccess] = useState<{
    roleCodes: string[];
    scopes: ScopeRow[];
    reason: string;
  }>({ roleCodes: [], scopes: [], reason: "Access review" });
  const [assignRoleForm, setAssignRoleForm] = useState<{
    roleCode: string;
    validFrom: string;
    validUntil: string;
    isPrimary: boolean;
    reason: string;
  }>({
    roleCode: "FACULTY",
    validFrom: new Date().toISOString().slice(0, 10),
    validUntil: "",
    isPrimary: false,
    reason: "Assigned staff role per administrative order",
  });
  const [error, setError] = useState("");
  const [resetResult, setResetResult] = useState<PasswordResetResult | null>(
    null,
  );
  const [historyUser, setHistoryUser] = useState<UserRow | null>(null);
  const canCreate = user?.permissions.includes("users.create") ?? false;
  const canReadRoles = user?.permissions.includes("roles.read") ?? false;
  const canManageRoles = user?.permissions.includes("roles.manage") ?? false;
  const canManageScopes = user?.permissions.includes("scopes.manage") ?? false;
  const canManageAccess = canManageRoles && canManageScopes;
  const canChangeStatus = user?.permissions.includes("users.suspend") ?? false;
  const canResetPassword =
    user?.permissions.includes("users.reset_password") ?? false;
  const users = useQuery({
    queryKey: ["users", search, roleFilter, statusFilter, firstLoginFilter],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (firstLoginFilter) params.set("firstLogin", firstLoginFilter);
      return api.get<PageResponse<UserRow>>(`/users?${params}`);
    },
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<Role[]>("/roles"),
    enabled: canReadRoles,
  });
  const options = useQuery({
    queryKey: ["scope-options"],
    queryFn: () => api.get<ScopeOptions>("/users/scope-options"),
    enabled: Boolean(mode) && canManageScopes,
  });
  const roleHistory = useQuery({
    queryKey: ["users", historyUser?.publicId, "role-history"],
    queryFn: () =>
      api.get<RoleHistoryResult>(
        `/users/${historyUser?.publicId}/role-history`,
      ),
    enabled: Boolean(historyUser) && canReadRoles,
  });
  const programmes = useMemo(
    () =>
      options.data?.programmes.filter(
        (item) => !form.departmentId || item.departmentId === form.departmentId,
      ) ?? [],
    [options.data, form.departmentId],
  );
  const semesterIds = useMemo(
    () =>
      new Set(
        options.data?.semesters
          .filter(
            (item) =>
              !form.programmeId || item.programmeId === form.programmeId,
          )
          .map((item) => item.id) ?? [],
      ),
    [options.data, form.programmeId],
  );
  const sections = useMemo(
    () =>
      options.data?.sections.filter((item) =>
        semesterIds.has(item.semesterId ?? ""),
      ) ?? [],
    [options.data, semesterIds],
  );

  function serializeScopes(rows: ScopeRow[]) {
    return rows.map((scope) =>
      scope.type === "ISSUE_CATEGORY"
        ? { type: scope.type, issueCategoryId: scope.targetId }
        : scope.type === "ASSIGNED_ISSUES"
          ? { type: scope.type }
          : { type: scope.type, id: scope.targetId },
    );
  }
  const create = useMutation({
    mutationFn: () =>
      api.post("/users", {
        collegeIdentityId: form.collegeIdentityId,
        fullName: form.fullName,
        ...(form.email ? { email: form.email } : {}),
        ...(form.mobile ? { mobile: form.mobile } : {}),
        ...(form.whatsappNumber ? { whatsappNumber: form.whatsappNumber } : {}),
        temporaryPassword: form.temporaryPassword,
        accountStatus: form.accountStatus,
        roleCodes: form.roleCodes,
        scopes: serializeScopes(form.scopes),
        ...(form.profileType === "student"
          ? {
              studentProfile: {
                departmentId: form.departmentId,
                programmeId: form.programmeId,
                sectionId: form.sectionId,
                studentId: form.studentId || form.collegeIdentityId,
                admissionYear: form.admissionYear,
                ...(form.rollNumber ? { rollNumber: form.rollNumber } : {}),
              },
            }
          : {}),
        ...(form.profileType === "staff"
          ? {
              staffProfile: {
                ...(form.departmentId
                  ? { departmentId: form.departmentId }
                  : {}),
                employeeId: form.employeeId || form.collegeIdentityId,
                ...(form.designation ? { designation: form.designation } : {}),
              },
            }
          : {}),
      }),
    onSuccess: () => {
      if (addAnother) {
        setForm({ ...blank, temporaryPassword: generateTemporaryPassword() });
        setError("");
        void client.invalidateQueries({ queryKey: ["users"] });
        return;
      }
      close();
    },
    onError: handleError,
  });
  const updateAccess = useMutation({
    mutationFn: () =>
      api.patch(`/users/${selected?.publicId}/access`, {
        roleCodes: access.roleCodes,
        scopes: serializeScopes(access.scopes),
        reason: access.reason,
      }),
    onSuccess: () => close(),
    onError: handleError,
  });
  const updateStatus = useMutation({
    mutationFn: ({
      user,
      status,
      reason,
    }: {
      user: UserRow;
      status: string;
      reason: string;
    }) => api.patch(`/users/${user.publicId}/status`, { status, reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["users"] }),
    onError: handleError,
  });
  const resetPassword = useMutation({
    mutationFn: ({
      target,
      temporaryPassword,
      reason,
    }: {
      target: UserRow;
      temporaryPassword?: string;
      reason: string;
    }) =>
      api.post<PasswordResetResult>(
        `/users/${target.publicId}/reset-password`,
        {
          ...(temporaryPassword ? { temporaryPassword } : {}),
          requirePasswordChange: true,
          reason,
        },
      ),
    onSuccess: (result) => {
      setResetResult(result);
      void client.invalidateQueries({ queryKey: ["users"] });
    },
    onError: handleError,
  });

  const assignRole = useMutation({
    mutationFn: () =>
      api.post(`/users/${selected?.publicId}/roles`, {
        roleCode: assignRoleForm.roleCode,
        validFrom: assignRoleForm.validFrom ? new Date(assignRoleForm.validFrom).toISOString() : undefined,
        validUntil: assignRoleForm.validUntil ? new Date(assignRoleForm.validUntil).toISOString() : undefined,
        isPrimary: assignRoleForm.isPrimary,
        reason: assignRoleForm.reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["users"] });
      close();
    },
    onError: handleError,
  });

  const removeRole = useMutation({
    mutationFn: ({ roleCode, reason }: { roleCode: string; reason: string }) =>
      api.delete(`/users/${selected?.publicId}/roles/${encodeURIComponent(roleCode)}`, { reason: reason.trim() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["users"] });
      close();
    },
    onError: handleError,
  });

  function handleError(caught: unknown) {
    setError(
      caught instanceof ApiError
        ? caught.message
        : "The account change could not be saved.",
    );
  }
  function close() {
    setMode(null);
    setSelected(null);
    setForm(blank);
    setShowTempPassword(false);
    setAddAnother(false);
    setError("");
    void client.invalidateQueries({ queryKey: ["users"] });
  }
  function toggleRole(
    code: string,
    current: string[],
    change: (roles: string[]) => void,
  ) {
    change(
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  }
  function updateScope(
    rows: ScopeRow[],
    index: number,
    value: Partial<ScopeRow>,
  ) {
    return rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...value } : row,
    );
  }
  function choicesForScope(type: string): Option[] {
    const key = optionKey[type];
    return key && options.data ? options.data[key] : [];
  }
  function openAccess(user: UserRow) {
    setSelected(user);
    setError("");
    setAccess({
      roleCodes: user.roles.map((entry) => entry.role.code),
      scopes: user.scopes.map((scope) => ({
        type: scope.scopeType,
        targetId: scope.issueCategoryId ?? scope.scopeId ?? "",
      })),
      reason: "Access review",
    });
    setMode("access");
  }
  function openAssignRole(user: UserRow) {
    setSelected(user);
    setError("");
    setAssignRoleForm({
      roleCode: roles.data?.[0]?.code ?? "FACULTY",
      validFrom: new Date().toISOString().slice(0, 10),
      validUntil: "",
      isPrimary: user.roles.length === 0,
      reason: "Staff assignment update",
    });
    setMode("assign-role");
  }
  function changeStatus(user: UserRow) {
    const status = user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const reason = window.prompt(
      `Reason to set ${user.fullName} to ${status.toLowerCase()}:`,
    );
    if (reason && reason.trim().length >= 3)
      updateStatus.mutate({ user, status, reason: reason.trim() });
  }
  function resetUserPassword(target: UserRow) {
    setError("");
    setResetResult(null);
    const reason = window.prompt(
      `Reason to reset ${target.fullName}'s password:`,
    );
    if (!reason || reason.trim().length < 3) return;
    const temporaryPassword = window
      .prompt("Temporary password (leave blank to generate securely):")
      ?.trim();
    resetPassword.mutate({
      target,
      temporaryPassword: temporaryPassword || undefined,
      reason: reason.trim(),
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "create" && canCreate) create.mutate();
    else if (mode === "access" && canManageAccess) updateAccess.mutate();
    else if (mode === "assign-role" && canManageRoles) assignRole.mutate();
  }
  function departmentLabel(item: UserRow) {
    return (
      item.studentProfile?.department.code ??
      item.staffProfile?.department?.code ??
      "-"
    );
  }
  function sectionLabel(item: UserRow) {
    return item.studentProfile?.section.code ?? "-";
  }
  function firstLoginLabel(item: UserRow) {
    return item.mustChangePassword
      ? "Required"
      : item.firstLoginCompletedAt
        ? "Completed"
        : "Not required";
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            People & accounts
          </h1>
          <p className="page-subtitle">
            Create users and assign multiple roles with explicit access scopes.
          </p>
        </div>
        {canCreate && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setMode("create");
              setForm({
                ...blank,
                temporaryPassword: generateTemporaryPassword(),
              });
            }}
          >
            <UserPlus size={18} />
            Add person
          </button>
        )}
      </div>
      {error && !mode && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {resetResult && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <strong>
            Temporary password generated for {resetResult.fullName}
          </strong>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            This is shown once. Share it securely; the user must change it at
            next login.
          </p>
          <code>{resetResult.temporaryPassword}</code>
        </div>
      )}
      <div className="card filters user-filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Search users"
            placeholder="Search name, ID or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="select-field">
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="">All roles</option>
            {roles.data?.map((role) => (
              <option value={role.code} key={role.code}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <select
            aria-label="Filter by account status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {accountStatuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <select
            aria-label="Filter by first-login status"
            value={firstLoginFilter}
            onChange={(event) => setFirstLoginFilter(event.target.value)}
          >
            <option value="">All first-login states</option>
            <option value="REQUIRED">Password change required</option>
            <option value="COMPLETED">First login completed</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop: 16 }}>
        {users.isLoading ? (
          <LoadingState />
        ) : users.isError ? (
          <ErrorState message="You do not have access to user administration." />
        ) : !users.data?.data.length ? (
          <EmptyState title="No people found" />
        ) : (
          <>
            <div className="users-table-wrap card table-wrap">
              <table>
                <thead>
                <tr>
                  <th>Person</th>
                  <th>College ID</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Section</th>
                  <th>Contact</th>
                  <th>First login</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  {(canManageAccess ||
                    canChangeStatus ||
                    canResetPassword ||
                    canReadRoles) && (
                    <th>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((item) => (
                  <tr key={item.publicId}>
                    <td>
                      <strong>{item.fullName}</strong>
                      {item.mustChangePassword && (
                        <small className="muted" style={{ display: "block" }}>
                          Password change required
                        </small>
                      )}
                    </td>
                    <td>{item.collegeIdentityId}</td>
                    <td>
                      {item.roles.map((role) => role.role.name).join(", ")}
                    </td>
                    <td>{departmentLabel(item)}</td>
                    <td>{sectionLabel(item)}</td>
                    <td>{item.email ?? item.mobile ?? "-"}</td>
                    <td>{firstLoginLabel(item)}</td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>
                      {item.lastLoginAt
                        ? new Date(item.lastLoginAt).toLocaleString()
                        : "Never"}
                    </td>
                    {(canManageAccess ||
                      canManageRoles ||
                      canChangeStatus ||
                      canResetPassword ||
                      canReadRoles) && (
                      <td>
                        <div
                          style={{ display: "flex", gap: 7, flexWrap: "wrap" }}
                        >
                          {canManageAccess && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => openAccess(item)}
                            >
                              <ShieldCheck size={16} />
                              Access
                            </button>
                          )}
                          {canManageRoles && (
                            <button
                              className="btn btn-secondary"
                              style={{ borderColor: "#bfdbfe", background: "#eff6ff", color: "#1d4ed8" }}
                              onClick={() => openAssignRole(item)}
                            >
                              <UserPlus size={16} />
                              Assign role
                            </button>
                          )}
                          {canReadRoles && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => setHistoryUser(item)}
                            >
                              <History size={16} />
                              History
                            </button>
                          )}
                          {canResetPassword && (
                            <button
                              className="btn btn-secondary"
                              disabled={resetPassword.isPending}
                              onClick={() => resetUserPassword(item)}
                            >
                              <KeyRound size={16} />
                              Reset
                            </button>
                          )}
                          {canChangeStatus && (
                            <button
                              className="btn btn-secondary"
                              disabled={updateStatus.isPending}
                              onClick={() => changeStatus(item)}
                            >
                              {item.status === "ACTIVE"
                                ? "Suspend"
                                : "Activate"}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="users-mobile-list">
            {users.data.data.map((item) => (
              <div className="user-card" key={item.publicId}>
                <header>
                  <div>
                    <span className="eyebrow">{item.collegeIdentityId}</span>
                    <h3>{item.fullName}</h3>
                  </div>
                  <StatusBadge value={item.status} />
                </header>
                <div className="user-card-meta">
                  <span>{item.roles.map((r) => r.role.name).join(", ")}</span>
                  {departmentLabel(item) !== "-" && (
                    <span> - {departmentLabel(item)}</span>
                  )}
                  {sectionLabel(item) !== "-" && (
                    <span> - Sec {sectionLabel(item)}</span>
                  )}
                  <span> - {firstLoginLabel(item)}</span>
                </div>
                {(item.email ?? item.mobile) && (
                  <div className="user-card-meta">
                    {item.email ?? item.mobile}
                  </div>
                )}
                {item.mustChangePassword && (
                  <div style={{ color: "var(--warning)", fontSize: "0.78rem", fontWeight: 600 }}>
                    Password change required
                  </div>
                )}
                {(canManageAccess ||
                  canManageRoles ||
                  canChangeStatus ||
                  canResetPassword ||
                  canReadRoles) && (
                  <div className="user-card-actions">
                    {canManageAccess && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => openAccess(item)}
                      >
                        <ShieldCheck size={14} />
                        Access
                      </button>
                    )}
                    {canManageRoles && (
                      <button
                        className="btn btn-secondary"
                        style={{ borderColor: "#bfdbfe", background: "#eff6ff", color: "#1d4ed8" }}
                        onClick={() => openAssignRole(item)}
                      >
                        <UserPlus size={14} />
                        Assign role
                      </button>
                    )}
                    {canReadRoles && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => setHistoryUser(item)}
                      >
                        <History size={14} />
                        History
                      </button>
                    )}
                    {canResetPassword && (
                      <button
                        className="btn btn-secondary"
                        disabled={resetPassword.isPending}
                        onClick={() => resetUserPassword(item)}
                      >
                        <KeyRound size={14} />
                        Reset
                      </button>
                    )}
                    {canChangeStatus && (
                      <button
                        className="btn btn-secondary"
                        disabled={updateStatus.isPending}
                        onClick={() => changeStatus(item)}
                      >
                        {item.status === "ACTIVE" ? "Suspend" : "Activate"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      {historyUser && canReadRoles && (
        <div className="modal-backdrop">
          <section
            className="card modal-panel role-history-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-history-title"
          >
            <header>
              <div>
                <span className="eyebrow">Authorization audit</span>
                <h2 id="role-history-title">
                  Role history for {historyUser.fullName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setHistoryUser(null)}
                aria-label="Close role history"
              >
                <X />
              </button>
            </header>
            {roleHistory.isLoading ? (
              <LoadingState />
            ) : roleHistory.isError ? (
              <ErrorState message="Role history could not be loaded." />
            ) : !roleHistory.data?.history.length ? (
              <EmptyState title="No role changes recorded" />
            ) : (
              <div className="role-history-list">
                {roleHistory.data.history.map((entry) => (
                  <article key={entry.id} className="role-history-entry">
                    <div className="role-history-entry-heading">
                      <strong>
                        {entry.previousRoles.join(", ") || "No roles"}
                        <span aria-hidden="true"> &rarr; </span>
                        {entry.newRoles.join(", ") || "No roles"}
                      </strong>
                      <time dateTime={entry.changedAt}>
                        {new Date(entry.changedAt).toLocaleString()}
                      </time>
                    </div>
                    <dl>
                      <div>
                        <dt>Scope change</dt>
                        <dd>
                          {summarizeScopes(entry.previousScopes)}
                          <span aria-hidden="true"> &rarr; </span>
                          {summarizeScopes(entry.newScopes)}
                        </dd>
                      </div>
                      <div>
                        <dt>Changed by</dt>
                        <dd>{entry.changedBy?.fullName ?? "System"}</dd>
                      </div>
                      <div>
                        <dt>Reason</dt>
                        <dd>{entry.reason}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
            <footer>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setHistoryUser(null)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

      {mode &&
        ((mode === "create" && canCreate) ||
          (mode === "access" && canManageAccess) ||
          (mode === "assign-role" && canManageRoles)) && (
          <div className="modal-backdrop">
            <form
              className="card modal-panel"
              onSubmit={submit}
              style={{ maxWidth: 940 }}
            >
              <header>
                <div>
                  <span className="eyebrow">
                    {mode === "create" ? "New account" : mode === "assign-role" ? "Staff Roles" : "Authorization"}
                  </span>
                  <h2>
                    {mode === "create"
                      ? "Add a college user"
                      : mode === "assign-role"
                        ? `Role assignment for ${selected?.fullName}`
                        : `Edit access for ${selected?.fullName}`}
                  </h2>
                </div>
                <button type="button" onClick={close} aria-label="Close">
                  <X />
                </button>
              </header>
              {error && <div className="error-box">{error}</div>}
              {!canReadRoles && (
                <div className="error-box">
                  Role choices require the roles.read permission.
                </div>
              )}
              {!canManageScopes && (
                <div className="error-box">
                  Scope choices require the scopes.manage permission.
                </div>
              )}
              {roles.isError && (
                <div className="error-box">
                  Role choices could not be loaded.
                </div>
              )}
              {options.isError && (
                <div className="error-box">
                  Access scope choices could not be loaded.
                </div>
              )}
              {mode === "create" && (
                <>
                  <div className="form-grid">
                    <div className="field">
                      <label>Full name</label>
                      <input
                        className="input"
                        required
                        value={form.fullName}
                        onChange={(event) =>
                          setForm({ ...form, fullName: event.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>College or employee ID</label>
                      <input
                        className="input"
                        required
                        value={form.collegeIdentityId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            collegeIdentityId: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Email</label>
                      <input
                        className="input"
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          setForm({ ...form, email: event.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Mobile</label>
                      <input
                        className="input"
                        value={form.mobile}
                        onChange={(event) =>
                          setForm({ ...form, mobile: event.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>WhatsApp number</label>
                      <input
                        className="input"
                        value={form.whatsappNumber}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            whatsappNumber: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Profile type</label>
                      <select
                        className="input"
                        value={form.profileType}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            profileType: event.target
                              .value as CreateForm["profileType"],
                          })
                        }
                      >
                        <option value="student">Student</option>
                        <option value="staff">Staff</option>
                        <option value="none">Administrative account</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Account status</label>
                      <select
                        className="input"
                        value={form.accountStatus}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            accountStatus: event.target.value,
                          })
                        }
                      >
                        {accountStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field form-span">
                      <label>Temporary password</label>
                      <div className="temporary-password-row">
                        <div style={{ position: "relative", flex: 1 }}>
                          <input
                            className="input"
                            type={showTempPassword ? "text" : "password"}
                            minLength={12}
                            required
                            value={form.temporaryPassword}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                temporaryPassword: event.target.value,
                              })
                            }
                            style={{ paddingRight: 46 }}
                          />
                          <button
                            type="button"
                            aria-label={
                              showTempPassword
                                ? "Hide temporary password"
                                : "Show temporary password"
                            }
                            onClick={() =>
                              setShowTempPassword(!showTempPassword)
                            }
                          >
                            {showTempPassword ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )}
                          </button>
                        </div>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              temporaryPassword: generateTemporaryPassword(),
                            })
                          }
                        >
                          <RefreshCw size={16} />
                          Generate
                        </button>
                      </div>
                      <small className="muted">
                        The user must change this password at first login.
                      </small>
                    </div>
                  </div>
                  {form.profileType !== "none" && (
                    <div className="form-grid">
                      <div className="field">
                        <label>Department</label>
                        <select
                          className="input"
                          required={form.profileType === "student"}
                          value={form.departmentId}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              departmentId: event.target.value,
                              programmeId: "",
                              sectionId: "",
                            })
                          }
                        >
                          <option value="">Select department</option>
                          {options.data?.departments.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.code} - {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {form.profileType === "student" ? (
                        <>
                          <div className="field">
                            <label>Programme</label>
                            <select
                              className="input"
                              required
                              value={form.programmeId}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  programmeId: event.target.value,
                                  sectionId: "",
                                })
                              }
                            >
                              <option value="">Select programme</option>
                              {programmes.map((item) => (
                                <option value={item.id} key={item.id}>
                                  {item.code} - {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label>Section</label>
                            <select
                              className="input"
                              required
                              value={form.sectionId}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  sectionId: event.target.value,
                                })
                              }
                            >
                              <option value="">Select section</option>
                              {sections.map((item) => (
                                <option value={item.id} key={item.id}>
                                  {item.code} - {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label>Student ID</label>
                            <input
                              className="input"
                              placeholder="Defaults to college ID"
                              value={form.studentId}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  studentId: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="field">
                            <label>Admission year</label>
                            <input
                              className="input"
                              type="number"
                              min={1990}
                              max={2200}
                              value={form.admissionYear}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  admissionYear: Number(event.target.value),
                                })
                              }
                            />
                          </div>
                          <div className="field">
                            <label>Roll number</label>
                            <input
                              className="input"
                              value={form.rollNumber}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  rollNumber: event.target.value,
                                })
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="field">
                            <label>Employee ID</label>
                            <input
                              className="input"
                              placeholder="Defaults to college ID"
                              value={form.employeeId}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  employeeId: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="field">
                            <label>Designation</label>
                            <input
                              className="input"
                              value={form.designation}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  designation: event.target.value,
                                })
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {(mode === "create" || mode === "access") && (
                <>
                  <section style={{ marginTop: 16 }}>
                    <h3>Roles</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {roles.data?.map((role) => {
                        const checked = (
                          mode === "create" ? form.roleCodes : access.roleCodes
                        ).includes(role.code);
                        return (
                          <label
                            className="btn btn-secondary"
                            key={role.code}
                            style={{ background: checked ? "#eff6ff" : undefined }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                mode === "create"
                                  ? toggleRole(
                                      role.code,
                                      form.roleCodes,
                                      (roleCodes) =>
                                        setForm({ ...form, roleCodes }),
                                    )
                                  : toggleRole(
                                      role.code,
                                      access.roleCodes,
                                      (roleCodes) =>
                                        setAccess({ ...access, roleCodes }),
                                    )
                              }
                            />
                            {role.name}
                          </label>
                        );
                      })}
                    </div>
                  </section>
                  <section style={{ marginTop: 16 }}>
                    <div className="section-head">
                      <div>
                        <h3>Access scopes</h3>
                        <p>
                          Every role is constrained by one or more server-enforced
                          scopes. Leaving target unassigned applies the scope across
                          the institution.
                        </p>
                      </div>
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        {scopeOptions.map((option) => (
                          <button
                            type="button"
                            key={option.type}
                            className="btn btn-secondary"
                            onClick={() =>
                              mode === "create"
                                ? setForm({
                                    ...form,
                                    scopes: [
                                      ...form.scopes,
                                      { type: option.type, targetId: "" },
                                    ],
                                  })
                                : setAccess({
                                    ...access,
                                    scopes: [
                                      ...access.scopes,
                                      { type: option.type, targetId: "" },
                                    ],
                                  })
                            }
                          >
                            <Plus size={15} />
                            Add {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(mode === "create" ? form.scopes : access.scopes).map(
                      (scopeRow, index) => {
                        const currentScopes =
                          mode === "create" ? form.scopes : access.scopes;
                        const row = scopeRow as ScopeRow;
                        const choices = choicesForScope(row.type);
                        return (
                          <div
                            className="scope-row"
                            key={`${index}-${row.type}`}
                          >
                            <span className="badge">
                              {
                                scopeOptions.find(
                                  (item) => item.type === row.type,
                                )?.label
                              }
                            </span>
                            <select
                              className="input"
                              value={row.targetId ?? ""}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (mode === "create") {
                                  const updated = form.scopes.map(
                                    (row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, targetId: nextValue }
                                        : row,
                                  );
                                  setForm({ ...form, scopes: updated });
                                } else {
                                  const updated = updateScope(
                                    access.scopes,
                                    index,
                                    { targetId: nextValue },
                                  );
                                  setAccess({ ...access, scopes: updated });
                                }
                              }}
                            >
                              <option value="">Whole institution</option>
                              {choices.map((choice) => (
                                <option
                                  value={choice.id}
                                  key={choice.id}
                                >
                                  {"code" in choice && choice.code
                                    ? `${choice.code} - ${choice.name}`
                                    : choice.name}
                                </option>
                              ))}
                            </select>
                            {currentScopes.length > 1 && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Remove scope"
                                onClick={() =>
                                  mode === "create"
                                    ? setForm({
                                        ...form,
                                        scopes: form.scopes.filter(
                                          (_, rowIndex) => rowIndex !== index,
                                        ),
                                      })
                                    : setAccess({
                                        ...access,
                                        scopes: access.scopes.filter(
                                          (_, rowIndex) => rowIndex !== index,
                                        ),
                                      })
                                }
                              >
                                <X size={17} />
                              </button>
                            )}
                          </div>
                        );
                      },
                    )}
                  </section>
                  {mode === "access" && (
                    <div className="field">
                      <label>Change reason</label>
                      <input
                        className="input"
                        required
                        minLength={3}
                        value={access.reason}
                        onChange={(event) =>
                          setAccess({ ...access, reason: event.target.value })
                        }
                      />
                      <small className="muted">
                        Saving access changes signs this person out on every device.
                      </small>
                    </div>
                  )}
                </>
              )}

              {mode === "assign-role" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
                  <section>
                    <h3 style={{ fontSize: "0.95rem", marginBottom: 10 }}>Currently assigned roles</h3>
                    {!selected?.roles.length ? (
                      <p className="muted">No roles assigned yet.</p>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {selected.roles.map((entry) => (
                          <div
                            key={entry.role.code}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              fontSize: "0.85rem",
                              fontWeight: 600
                            }}
                          >
                            <Award size={15} style={{ color: "var(--primary)" }} />
                            <span>{entry.role.name}</span>
                            {entry.isPrimary && <span className="badge badge-success" style={{ padding: "2px 6px", fontSize: "0.72rem" }}>Primary</span>}
                            <button
                              type="button"
                              className="icon-button danger"
                              style={{ padding: 2, height: 22, width: 22 }}
                              title="Revoke role"
                              disabled={removeRole.isPending}
                              onClick={() => {
                                const reason = window.prompt(`Reason for revoking role ${entry.role.name} from ${selected.fullName}:`);
                                if (reason && reason.trim().length >= 3) {
                                  removeRole.mutate({ roleCode: entry.role.code, reason });
                                }
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                    <h3 style={{ fontSize: "0.95rem", marginBottom: 12 }}>Assign a new staff role</h3>
                    <div className="form-grid">
                      <div className="field">
                        <label>Staff role</label>
                        <select
                          className="input"
                          value={assignRoleForm.roleCode}
                          onChange={(e) => setAssignRoleForm({ ...assignRoleForm, roleCode: e.target.value })}
                        >
                          {roles.data?.map((role) => (
                            <option key={role.code} value={role.code}>
                              {role.name} ({role.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Valid from</label>
                        <input
                          type="date"
                          className="input"
                          value={assignRoleForm.validFrom}
                          onChange={(e) => setAssignRoleForm({ ...assignRoleForm, validFrom: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>Valid until (optional)</label>
                        <input
                          type="date"
                          className="input"
                          value={assignRoleForm.validUntil}
                          onChange={(e) => setAssignRoleForm({ ...assignRoleForm, validUntil: e.target.value })}
                        />
                      </div>
                      <div className="field full">
                        <label>Assignment reason (required audit log)</label>
                        <input
                          type="text"
                          className="input"
                          required
                          placeholder="e.g. Appointed as HOD per order #2026-08"
                          value={assignRoleForm.reason}
                          onChange={(e) => setAssignRoleForm({ ...assignRoleForm, reason: e.target.value })}
                        />
                      </div>
                      <div className="field full">
                        <label className="checkbox-row" style={{ marginTop: 4 }}>
                          <input
                            type="checkbox"
                            checked={assignRoleForm.isPrimary}
                            onChange={(e) => setAssignRoleForm({ ...assignRoleForm, isPrimary: e.target.checked })}
                          />
                          Set as primary role for this user
                        </label>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              <footer>
                {mode === "create" && (
                  <label
                    className="checkbox-row"
                    style={{ marginRight: "auto" }}
                  >
                    <input
                      type="checkbox"
                      checked={addAnother}
                      onChange={(event) => setAddAnother(event.target.checked)}
                    />
                    Add another after saving
                  </label>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    create.isPending ||
                    updateAccess.isPending ||
                    assignRole.isPending ||
                    roles.isLoading ||
                    options.isLoading ||
                    roles.isError ||
                    options.isError ||
                    !canReadRoles ||
                    (mode !== "assign-role" && !canManageScopes) ||
                    (mode === "create" && !form.roleCodes.length) ||
                    (mode === "access" && !access.roleCodes.length) ||
                    (mode === "assign-role" && !assignRoleForm.reason.trim())
                  }
                >
                  <Plus size={17} />
                  {create.isPending || updateAccess.isPending || assignRole.isPending
                    ? "Saving..."
                    : mode === "create"
                      ? "Create account"
                      : mode === "assign-role"
                        ? "Save role assignment"
                        : "Save access"}
                </button>
              </footer>
            </form>
          </div>
        )}
    </>
  );
}

function generateTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = `${upper}${lower}${digits}${special}`;
  const randomIndex = (max: number) => {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) % max;
  };
  const pick = (chars: string) =>
    chars[randomIndex(chars.length)] ?? chars[0] ?? "A";
  const chars = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
    ...Array.from({ length: 10 }, () => pick(all)),
  ];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    const current = chars[index] ?? "A";
    chars[index] = chars[swapIndex] ?? current;
    chars[swapIndex] = current;
  }
  return chars.join("");
}

function summarizeScopes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "No scopes";
  return value
    .map((scope) => {
      if (!scope || typeof scope !== "object") return "Unknown";
      const row = scope as Record<string, unknown>;
      const type = String(row.type ?? row.scopeType ?? "Scope");
      const target = row.id ?? row.scopeId ?? row.issueCategoryId;
      return target ? `${type}: ${String(target).slice(0, 8)}` : type;
    })
    .join(", ");
}
