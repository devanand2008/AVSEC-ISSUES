"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  Layers3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LoadingState } from "@/components/query-state";
import { ActionMenu } from "@/components/ui/action-menu";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  academicYearsForProgramme,
  activeProgrammes,
  buildDepartmentPayload,
  buildSectionPayload,
  departmentCampusName,
  filterDepartments,
  normalizeAcademicIdentity,
  positiveDependencies,
  preferredCampusId,
  sectionCapacity,
  sectionsForDepartment,
  selectedDepartmentId,
  semestersForSectionDraft,
  staffAssignmentCandidates,
  studyYearsForProgrammeYear,
  validateDepartmentDraft,
  validateSectionDraft,
  validateSectionEditDraft,
  type DepartmentDraft,
  type DepartmentFilter,
  type SectionDraft,
  type WorkspaceAcademicYear,
  type WorkspaceCampus,
  type WorkspaceDepartment,
  type WorkspaceProgramme,
  type WorkspaceSection,
} from "./departments-sections";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface DepartmentSummary extends WorkspaceDepartment {
  campusId: string | null;
  campus: { id: string; name: string } | null;
  description: string | null;
  _count: {
    programmes: number;
    studentProfiles: number;
    staffProfiles: number;
    rooms: number;
    issues: number;
    classes: number;
  };
}

interface DepartmentDetail extends DepartmentSummary {
  programmes: Array<
    WorkspaceProgramme & {
      durationYears: number;
      semesters: Array<
        WorkspaceProgramme["semesters"][number] & {
          academicYear: WorkspaceAcademicYear;
        }
      >;
    }
  >;
}

interface AdminSection extends WorkspaceSection {
  displayName: string | null;
  assignedRoomId: string | null;
  officialGroupEnabled: boolean;
  assignedRoom: {
    id: string;
    code: string;
    name: string;
    floor: { name: string; block: { name: string } };
  } | null;
  coordinatorAssignments: Array<{
    coordinator: { publicId: string; fullName: string };
  }>;
  staffAssignments: Array<{
    assignmentType: string;
    staff: { publicId: string; fullName: string };
  }>;
  _count: { studentProfiles: number; attendanceSessions: number };
}

interface AssignmentUser {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  roles: Array<{ role: { code: string; name: string } }>;
}

interface AssignmentOptions {
  users: AssignmentUser[];
}

interface ScopeOptions {
  rooms: Array<{ id: string; code: string; name: string }>;
}

type EntityKind = "department" | "section";
type LifecycleAction = "activate" | "deactivate" | "archive" | "restore";

interface EntityTarget {
  kind: EntityKind;
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt?: string | null;
}

interface LifecycleTarget extends EntityTarget {
  action: LifecycleAction;
}

interface DependencyReport {
  department?: EntityTarget;
  section?: EntityTarget;
  dependencies: Record<string, number>;
  dependencyCount: number;
  canDelete: boolean;
}

type EditorState =
  | { type: "department"; mode: "create"; department?: undefined }
  | { type: "department"; mode: "edit"; department: DepartmentSummary }
  | { type: "section"; mode: "create"; section?: undefined }
  | { type: "section"; mode: "edit"; section: AdminSection };

const workspaceQueryKey = ["academic-workspace"] as const;

export function DepartmentsSectionsWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.permissions.includes("academic.manage") ?? false;
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<DepartmentFilter>("ALL");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [viewSection, setViewSection] = useState<AdminSection | null>(null);
  const [lifecycleTarget, setLifecycleTarget] =
    useState<LifecycleTarget | null>(null);
  const [dependencyTarget, setDependencyTarget] =
    useState<EntityTarget | null>(null);
  const [success, setSuccess] = useState("");

  const departments = useQuery({
    queryKey: [...workspaceQueryKey, "departments"],
    queryFn: () =>
      api.get<DepartmentSummary[]>("/academic/admin/departments"),
    enabled: canManage,
  });
  const campuses = useQuery({
    queryKey: [...workspaceQueryKey, "campuses"],
    queryFn: () => api.get<WorkspaceCampus[]>("/locations/campuses"),
    enabled: canManage,
  });
  const academicYears = useQuery({
    queryKey: [...workspaceQueryKey, "years"],
    queryFn: () =>
      api.get<WorkspaceAcademicYear[]>("/academic/admin/years"),
    enabled: canManage,
  });
  const sections = useQuery({
    queryKey: [...workspaceQueryKey, "sections"],
    queryFn: () => api.get<AdminSection[]>("/academic/admin/sections"),
    enabled: canManage,
  });
  const assignmentOptions = useQuery({
    queryKey: [...workspaceQueryKey, "assignment-options"],
    queryFn: () =>
      api.get<AssignmentOptions>("/academic/admin/assignments/options"),
    enabled: canManage,
  });
  const scopeOptions = useQuery({
    queryKey: [...workspaceQueryKey, "scope-options"],
    queryFn: () => api.get<ScopeOptions>("/users/scope-options"),
    enabled: canManage,
  });

  const visibleDepartments = useMemo(
    () =>
      filterDepartments(
        departments.data ?? [],
        search,
        statusFilter,
      ),
    [departments.data, search, statusFilter],
  );
  const effectiveDepartmentId = selectedDepartmentId(
    selectedId,
    visibleDepartments,
  );
  const departmentDetail = useQuery({
    queryKey: [
      ...workspaceQueryKey,
      "department",
      effectiveDepartmentId,
    ],
    queryFn: () =>
      api.get<DepartmentDetail>(
        `/academic/departments/${effectiveDepartmentId}`,
      ),
    enabled: canManage && Boolean(effectiveDepartmentId),
  });

  const programmes = useMemo(
    () => departmentDetail.data?.programmes ?? [],
    [departmentDetail.data?.programmes],
  );
  const departmentSections = useMemo(
    () =>
      sectionsForDepartment(
        sections.data ?? [],
        programmes,
        effectiveDepartmentId,
      ),
    [effectiveDepartmentId, programmes, sections.data],
  );

  async function refreshWorkspace() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: ["scope-options"] }),
    ]);
  }

  function openDepartment(departmentId: string, scroll = false) {
    setSelectedId(departmentId);
    if (scroll) {
      window.requestAnimationFrame(() =>
        document
          .getElementById("department-sections-detail")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }

  function entityForDepartment(department: DepartmentSummary): EntityTarget {
    return { kind: "department", ...department };
  }

  if (authLoading) {
    return (
      <div className="page-container main-with-bottom-nav">
        <LoadingState rows={6} />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="page-container main-with-bottom-nav">
        <ErrorState message="You do not have permission to manage academic departments and sections." />
      </div>
    );
  }

  const coreLoading =
    departments.isLoading || sections.isLoading || academicYears.isLoading;
  const coreError = departments.error ?? sections.error ?? academicYears.error;

  return (
    <div className="page-container main-with-bottom-nav academic-workspace-page">
      <PageHeader
        title="Departments & Sections"
        description="Manage the college department-to-class hierarchy, capacities, and lifecycle safely."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Academic Setup" },
          { label: "Departments & Sections" },
        ]}
        actions={
          <div className="academic-workspace-page-actions">
            <Link
              href="/admin/academic"
              className="avs-btn avs-btn-secondary"
            >
              <ExternalLink size={16} /> Advanced structure
            </Link>
            <button
              className="avs-btn avs-btn-primary"
              type="button"
              disabled={!campuses.data?.length}
              onClick={() =>
                setEditor({ type: "department", mode: "create" })
              }
            >
              <Plus size={16} /> Add Department
            </button>
          </div>
        }
      />

      {success && (
        <div className="academic-workspace-success" role="status">
          <CheckCircle2 size={18} />
          <span>{success}</span>
          <button
            className="avs-btn avs-btn-ghost avs-btn-icon"
            type="button"
            aria-label="Dismiss success message"
            onClick={() => setSuccess("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {!campuses.isLoading && !campuses.data?.length && (
        <div className="error-box" role="alert">
          Create or activate a campus before adding a department.
        </div>
      )}

      {coreLoading && <LoadingState rows={7} />}
      {coreError && (
        <ErrorState
          message={apiErrorMessage(coreError, "Academic setup could not be loaded.")}
          onRetry={() => {
            void departments.refetch();
            void sections.refetch();
            void academicYears.refetch();
          }}
        />
      )}

      {!coreLoading && !coreError && (
        <div className="academic-workspace-layout">
          <aside className="avs-card academic-department-master" aria-label="Departments">
            <div className="academic-department-master-header">
              <div>
                <h2>Departments</h2>
                <p>{departments.data?.length ?? 0} configured</p>
              </div>
              <button
                className="avs-btn avs-btn-primary avs-btn-sm"
                type="button"
                disabled={!campuses.data?.length}
                onClick={() =>
                  setEditor({ type: "department", mode: "create" })
                }
              >
                <Plus size={15} /> Add
              </button>
            </div>
            <div className="academic-department-filters">
              <label className="academic-department-search">
                <span className="sr-only">Search departments</span>
                <Search size={16} aria-hidden="true" />
                <input
                  className="input"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search departments"
                />
              </label>
              <label>
                <span className="sr-only">Filter department status</span>
                <select
                  className="input"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as DepartmentFilter)
                  }
                >
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
            </div>
            <div className="academic-department-list">
              {visibleDepartments.map((department) => {
                const active = department.id === effectiveDepartmentId;
                return (
                  <article
                    key={department.id}
                    className={`academic-department-item${active ? " is-selected" : ""}`}
                  >
                    <button
                      className="academic-department-select"
                      type="button"
                      aria-pressed={active}
                      onClick={() => openDepartment(department.id)}
                    >
                      <span className="academic-department-code">
                        {department.code}
                      </span>
                      <span className="academic-department-copy">
                        <strong>{department.name}</strong>
                        <small>
                          {department._count.classes} Sections -{" "}
                          {department._count.studentProfiles} Students
                        </small>
                      </span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                    <div className="academic-department-card-footer">
                      <EntityStatus entity={department} />
                      <button
                        className="avs-btn avs-btn-secondary avs-btn-sm academic-department-open"
                        type="button"
                        onClick={() => openDepartment(department.id, true)}
                      >
                        Open
                      </button>
                    </div>
                  </article>
                );
              })}
              {!visibleDepartments.length && (
                <div className="academic-workspace-empty">
                  <Building2 size={28} />
                  <p>No departments match these filters.</p>
                </div>
              )}
            </div>
          </aside>

          <main
            className="avs-card academic-department-detail"
            id="department-sections-detail"
          >
            {!effectiveDepartmentId && (
              <div className="academic-workspace-empty">
                <Building2 size={32} />
                <h2>Select a department</h2>
                <p>Open a department to view and manage its sections.</p>
              </div>
            )}
            {effectiveDepartmentId && departmentDetail.isLoading && (
              <LoadingState rows={5} />
            )}
            {effectiveDepartmentId && departmentDetail.isError && (
              <ErrorState
                message={apiErrorMessage(
                  departmentDetail.error,
                  "The selected department could not be loaded.",
                )}
                onRetry={() => void departmentDetail.refetch()}
              />
            )}
            {departmentDetail.data && (
              <>
                <div className="academic-department-detail-header">
                  <div className="academic-department-title-block">
                    <span className="academic-department-code academic-department-code-lg">
                      {departmentDetail.data.code}
                    </span>
                    <div>
                      <div className="academic-department-title-line">
                        <h2>{departmentDetail.data.name}</h2>
                        <EntityStatus entity={departmentDetail.data} />
                      </div>
                      <p>
                        {departmentDetail.data.description ||
                          `${departmentCampusName(departmentDetail.data)} academic department`}
                      </p>
                    </div>
                  </div>
                  <div className="academic-department-detail-actions">
                    <button
                      className="avs-btn avs-btn-primary"
                      type="button"
                      disabled={
                        !departmentDetail.data.isActive ||
                        Boolean(departmentDetail.data.archivedAt)
                      }
                      title={
                        departmentDetail.data.isActive &&
                        !departmentDetail.data.archivedAt
                          ? undefined
                          : "Restore or activate the department before adding a section."
                      }
                      onClick={() =>
                        setEditor({ type: "section", mode: "create" })
                      }
                    >
                      <Plus size={16} /> Add Section
                    </button>
                    <button
                      className="avs-btn avs-btn-secondary"
                      type="button"
                      onClick={() =>
                        setEditor({
                          type: "department",
                          mode: "edit",
                          department: departmentDetail.data,
                        })
                      }
                    >
                      <Edit3 size={16} /> Edit
                    </button>
                    <EntityActionMenu
                      entity={entityForDepartment(departmentDetail.data)}
                      onLifecycle={setLifecycleTarget}
                      onDependencies={setDependencyTarget}
                    />
                  </div>
                </div>

                <div className="academic-department-stats" aria-label="Department summary">
                  <SummaryStat label="Sections" value={departmentSections.length} />
                  <SummaryStat
                    label="Active students"
                    value={departmentSections.reduce(
                      (total, section) =>
                        total + sectionCapacity(section).current,
                      0,
                    )}
                  />
                  <SummaryStat
                    label="Programmes"
                    value={departmentDetail.data._count.programmes}
                  />
                  <SummaryStat
                    label="Staff"
                    value={departmentDetail.data._count.staffProfiles}
                  />
                </div>

                <div className="academic-sections-heading">
                  <div>
                    <h3>Sections</h3>
                    <p>
                      Active student count is measured against each section&apos;s
                      maximum capacity.
                    </p>
                  </div>
                </div>

                <div className="academic-section-list">
                  {departmentSections.map((section) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      onView={() => setViewSection(section)}
                      onEdit={() =>
                        setEditor({
                          type: "section",
                          mode: "edit",
                          section,
                        })
                      }
                      onLifecycle={setLifecycleTarget}
                      onDependencies={setDependencyTarget}
                    />
                  ))}
                  {!departmentSections.length && (
                    <div className="academic-workspace-empty academic-sections-empty">
                      <Layers3 size={30} />
                      <h3>No sections configured</h3>
                      <p>
                        Add the first section after the programme, academic year,
                        and semester are ready.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {editor?.type === "department" && (
        <DepartmentDialog
          key={`${editor.mode}-${editor.department?.id ?? "new"}`}
          mode={editor.mode}
          department={editor.department}
          departments={departments.data ?? []}
          campuses={campuses.data ?? []}
          onClose={() => setEditor(null)}
          onSaved={async (department) => {
            setStatusFilter("ALL");
            setSearch("");
            setSelectedId(department.id);
            setEditor(null);
            setSuccess(
              editor.mode === "create"
                ? `${department.name} was created.`
                : `${department.name} was updated.`,
            );
            await refreshWorkspace();
          }}
        />
      )}

      {editor?.type === "section" && departmentDetail.data && (
        <SectionDialog
          key={`${editor.mode}-${editor.section?.id ?? "new"}`}
          mode={editor.mode}
          department={departmentDetail.data}
          section={editor.section}
          sections={sections.data ?? []}
          academicYears={academicYears.data ?? []}
          rooms={scopeOptions.data?.rooms ?? []}
          assignmentUsers={assignmentOptions.data?.users ?? []}
          optionError={
            scopeOptions.isError || assignmentOptions.isError
              ? "Classroom or staff options could not be loaded. Optional assignments may be left blank."
              : ""
          }
          onClose={() => setEditor(null)}
          onSaved={async (section) => {
            setEditor(null);
            setSuccess(
              editor.mode === "create"
                ? `${section.name} was created.`
                : `${section.name} was updated.`,
            );
            await refreshWorkspace();
          }}
        />
      )}

      {viewSection && (
        <SectionViewDialog
          section={viewSection}
          onClose={() => setViewSection(null)}
        />
      )}

      {lifecycleTarget && (
        <LifecycleDialog
          target={lifecycleTarget}
          onClose={() => setLifecycleTarget(null)}
          onCompleted={async (message) => {
            setLifecycleTarget(null);
            setSuccess(message);
            await refreshWorkspace();
          }}
        />
      )}

      {dependencyTarget && (
        <DependenciesDialog
          key={`${dependencyTarget.kind}-${dependencyTarget.id}`}
          target={dependencyTarget}
          onClose={() => setDependencyTarget(null)}
          onDeleted={async (message) => {
            setDependencyTarget(null);
            if (dependencyTarget.kind === "department") setSelectedId("");
            setSuccess(message);
            await refreshWorkspace();
          }}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="academic-summary-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EntityStatus({ entity }: { entity: Pick<EntityTarget, "isActive" | "archivedAt"> }) {
  if (entity.archivedAt) {
    return <span className="avs-badge avs-badge-neutral">Archived</span>;
  }
  return entity.isActive ? (
    <span className="avs-badge avs-badge-success">Active</span>
  ) : (
    <span className="avs-badge avs-badge-warning">Inactive</span>
  );
}

function SectionCard({
  section,
  onView,
  onEdit,
  onLifecycle,
  onDependencies,
}: {
  section: AdminSection;
  onView: () => void;
  onEdit: () => void;
  onLifecycle: (target: LifecycleTarget) => void;
  onDependencies: (target: EntityTarget) => void;
}) {
  const capacity = sectionCapacity(section);
  const entity: EntityTarget = { kind: "section", ...section };
  return (
    <article className="academic-section-card">
      <div className="academic-section-identity">
        <span className="academic-section-code">{section.code}</span>
        <div>
          <div className="academic-section-title-line">
            <h4>{section.name}</h4>
            <EntityStatus entity={section} />
          </div>
          <p>
            {section.semester.programme.name} - {section.semester.academicYear.name}
            {section.studyYear ? ` - Year ${section.studyYear}` : ""}
          </p>
        </div>
      </div>
      <div className="academic-section-capacity">
        <div>
          <strong>
            {capacity.current} / {capacity.maximum}
          </strong>
          <span>Students</span>
        </div>
        <div
          className={`academic-capacity-bar${capacity.isFull ? " is-full" : ""}`}
          aria-label={`${capacity.current} of ${capacity.maximum} student places used`}
        >
          <span
            style={{
              width: `${Math.min(100, (capacity.current / Math.max(1, capacity.maximum)) * 100)}%`,
            }}
          />
        </div>
        <small>
          {capacity.isFull ? "Full" : `${capacity.available} seats available`}
        </small>
      </div>
      <div className="academic-section-meta">
        <span>
          <Building2 size={15} />
          {section.assignedRoom
            ? `${section.assignedRoom.code} - ${section.assignedRoom.name}`
            : "No classroom assigned"}
        </span>
        <span>
          <Users size={15} />
          {section.coordinatorAssignments[0]?.coordinator.fullName ??
            "No coordinator assigned"}
        </span>
      </div>
      <div className="academic-section-actions">
        <button
          className="avs-btn avs-btn-secondary avs-btn-sm"
          type="button"
          onClick={onView}
        >
          <Eye size={15} /> View
        </button>
        <button
          className="avs-btn avs-btn-secondary avs-btn-sm"
          type="button"
          onClick={onEdit}
        >
          <Edit3 size={15} /> Edit
        </button>
        <EntityActionMenu
          entity={entity}
          onLifecycle={onLifecycle}
          onDependencies={onDependencies}
        />
      </div>
    </article>
  );
}

function EntityActionMenu({
  entity,
  onLifecycle,
  onDependencies,
}: {
  entity: EntityTarget;
  onLifecycle: (target: LifecycleTarget) => void;
  onDependencies: (target: EntityTarget) => void;
}) {
  const items = [] as Array<{
    label: string;
    icon: ReactNode;
    onClick: () => void;
    danger?: boolean;
  }>;
  if (entity.archivedAt) {
    items.push({
      label: "Restore",
      icon: <RotateCcw size={15} />,
      onClick: () => onLifecycle({ ...entity, action: "restore" }),
    });
  } else {
    items.push(
      entity.isActive
        ? {
            label: "Deactivate",
            icon: <CircleOff size={15} />,
            onClick: () => onLifecycle({ ...entity, action: "deactivate" }),
          }
        : {
            label: "Activate",
            icon: <CheckCircle2 size={15} />,
            onClick: () => onLifecycle({ ...entity, action: "activate" }),
          },
    );
    items.push({
      label: "Archive",
      icon: <Archive size={15} />,
      onClick: () => onLifecycle({ ...entity, action: "archive" }),
      danger: true,
    });
  }
  items.push(
    {
      label: "View dependencies",
      icon: <Database size={15} />,
      onClick: () => onDependencies(entity),
    },
    {
      label: "Delete safely",
      icon: <Trash2 size={15} />,
      onClick: () => onDependencies(entity),
      danger: true,
    },
  );
  return <ActionMenu items={items} id={`${entity.kind}-${entity.id}-actions`} />;
}

function DepartmentDialog({
  mode,
  department,
  departments,
  campuses,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  department?: DepartmentSummary;
  departments: DepartmentSummary[];
  campuses: WorkspaceCampus[];
  onClose: () => void;
  onSaved: (department: DepartmentSummary) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DepartmentDraft>(() => ({
    campusId: department?.campusId ?? preferredCampusId(campuses),
    name: department?.name ?? "",
    code: department?.code ?? "",
    description: department?.description ?? "",
    isActive: department?.isActive ?? true,
  }));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const validation = validateDepartmentDraft(
        draft,
        departments,
        department?.id,
        mode === "create",
      );
      if (validation) throw new Error(validation);
      const payload = buildDepartmentPayload(draft);
      return mode === "create"
        ? api.post<DepartmentSummary>("/academic/departments", payload)
        : api.patch<DepartmentSummary>(
            `/academic/departments/${department!.id}`,
            {
              name: payload.name,
              code: payload.code,
              description: payload.description ?? null,
              isActive: department?.archivedAt ? false : payload.isActive,
            },
          );
    },
    onSuccess: (saved) => void onSaved(saved),
    onError: (caught) =>
      setError(apiErrorMessage(caught, "The department could not be saved.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <ModalFrame
      id="department-editor-title"
      title={mode === "create" ? "Add Department" : "Edit Department"}
      onClose={onClose}
      busy={save.isPending}
    >
      <form className="academic-modal-form" onSubmit={submit}>
        {error && <div className="error-box academic-modal-span" role="alert">{error}</div>}
        <FormField label="Department Name" required>
          <input
            className="input"
            required
            minLength={2}
            maxLength={180}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </FormField>
        <FormField label="Department Short Code" required>
          <input
            className="input"
            required
            maxLength={30}
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </FormField>
        <FormField label="Campus" required={mode === "create"}>
          <select
            className="input"
            required={mode === "create"}
            disabled={mode === "edit"}
            value={draft.campusId}
            onChange={(event) =>
              setDraft({ ...draft, campusId: event.target.value })
            }
          >
            <option value="">
              {mode === "edit" ? "College campus not assigned" : "Select campus..."}
            </option>
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.code} - {campus.name}
              </option>
            ))}
            {department?.campus &&
              draft.campusId &&
              !campuses.some((campus) => campus.id === draft.campusId) && (
                <option value={draft.campusId}>{department.campus.name}</option>
              )}
          </select>
          {mode === "create" && campuses.length > 1 && !preferredCampusId(campuses) && (
            <small>Select the campus for this department.</small>
          )}
        </FormField>
        <label className="academic-check-field">
          <input
            type="checkbox"
            checked={draft.isActive}
            disabled={mode === "edit" || Boolean(department?.archivedAt)}
            onChange={(event) =>
              setDraft({ ...draft, isActive: event.target.checked })
            }
          />
          Active
          {mode === "edit" ? " (use lifecycle actions to change status)" : ""}
        </label>
        <FormField label="Description" className="academic-modal-span">
          <textarea
            className="input"
            rows={4}
            maxLength={2000}
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </FormField>
        <ModalActions onClose={onClose} busy={save.isPending} label={mode === "create" ? "Create Department" : "Save Changes"} />
      </form>
    </ModalFrame>
  );
}

function SectionDialog({
  mode,
  department,
  section,
  sections,
  academicYears,
  rooms,
  assignmentUsers,
  optionError,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  department: DepartmentDetail;
  section?: AdminSection;
  sections: AdminSection[];
  academicYears: WorkspaceAcademicYear[];
  rooms: ScopeOptions["rooms"];
  assignmentUsers: AssignmentUser[];
  optionError: string;
  onClose: () => void;
  onSaved: (section: AdminSection) => Promise<void>;
}) {
  const currentSemester = department.programmes
    .flatMap((programme) => programme.semesters)
    .find((semester) => semester.id === section?.semesterId);
  const [draft, setDraft] = useState<SectionDraft>(() => ({
    departmentId: department.id,
    programmeId: section?.semester.programme.id ?? "",
    academicYearId: section?.semester.academicYear.id ?? "",
    studyYear: section
      ? String(section.studyYear ?? Math.ceil((currentSemester?.number ?? 1) / 2))
      : "",
    semesterId: section?.semesterId ?? "",
    name: section?.name ?? "",
    capacity: String(sectionCapacity(section ?? emptySection()).maximum),
    assignedRoomId: section?.assignedRoomId ?? "",
    coordinatorPublicId:
      section?.coordinatorAssignments[0]?.coordinator.publicId ?? "",
    prospectiveClassStaffPublicIds:
      section?.staffAssignments
        .filter(
          (assignment) =>
            assignment.assignmentType === "PROSPECTIVE_CLASS_STAFF",
        )
        .map((assignment) => assignment.staff.publicId) ?? [],
    isActive: section?.isActive ?? true,
  }));
  const [error, setError] = useState("");
  const staffCandidates = useMemo(
    () => staffAssignmentCandidates(assignmentUsers),
    [assignmentUsers],
  );
  const prospectiveCandidates = useMemo(() => {
    const candidates = new Map(
      staffCandidates.map((candidate) => [candidate.publicId, candidate]),
    );
    for (const assignment of section?.staffAssignments ?? []) {
      if (
        assignment.assignmentType === "PROSPECTIVE_CLASS_STAFF" &&
        !candidates.has(assignment.staff.publicId)
      ) {
        candidates.set(assignment.staff.publicId, {
          publicId: assignment.staff.publicId,
          collegeIdentityId: "Current assignment",
          fullName: assignment.staff.fullName,
          roles: [],
        });
      }
    }
    return [...candidates.values()];
  }, [section?.staffAssignments, staffCandidates]);
  const programmes = useMemo(
    () =>
      mode === "edit"
        ? department.programmes.filter(
            (programme) => programme.id === draft.programmeId,
          )
        : activeProgrammes(department.programmes, draft.departmentId),
    [department.programmes, draft.departmentId, draft.programmeId, mode],
  );
  const years = useMemo(
    () =>
      mode === "edit"
        ? academicYears.filter((year) => year.id === draft.academicYearId)
        : academicYearsForProgramme(
            department.programmes,
            academicYears,
            draft.departmentId,
            draft.programmeId,
          ),
    [
      academicYears,
      department.programmes,
      draft.academicYearId,
      draft.departmentId,
      draft.programmeId,
      mode,
    ],
  );
  const studyYears = useMemo(
    () =>
      mode === "edit"
        ? [Number(draft.studyYear)].filter((year) => Number.isInteger(year))
        : studyYearsForProgrammeYear(
            department.programmes,
            draft.departmentId,
            draft.programmeId,
            draft.academicYearId,
          ),
    [
      department.programmes,
      draft.academicYearId,
      draft.departmentId,
      draft.programmeId,
      draft.studyYear,
      mode,
    ],
  );
  const semesters = useMemo(
    () =>
      mode === "edit" && currentSemester
        ? [currentSemester]
        : semestersForSectionDraft(department.programmes, draft),
    [currentSemester, department.programmes, draft, mode],
  );

  const save = useMutation({
    mutationFn: () => {
      const validation =
        mode === "edit"
          ? validateSectionEditDraft(draft, sections, section!.id)
          : validateSectionDraft(draft, department.programmes, sections);
      if (validation) throw new Error(validation);
      const payload = buildSectionPayload(draft);
      if (mode === "create") {
        return api.post<AdminSection>("/academic/sections", payload);
      }
      const unchangedName =
        normalizeAcademicIdentity(draft.name) ===
        normalizeAcademicIdentity(section!.name);
      return api.patch<AdminSection>(`/academic/sections/${section!.id}`, {
        code: unchangedName ? section!.code : payload.code,
        name: unchangedName ? section!.name : payload.name,
        studyYear: payload.studyYear,
        capacity: payload.capacity,
        assignedRoomId: payload.assignedRoomId ?? null,
        officialGroupEnabled: section!.officialGroupEnabled,
        isActive: section?.archivedAt ? false : payload.isActive,
        coordinatorPublicId: draft.isActive
          ? draft.coordinatorPublicId || null
          : null,
        prospectiveClassStaffPublicIds: draft.isActive
          ? [...new Set(draft.prospectiveClassStaffPublicIds)]
          : [],
      });
    },
    onSuccess: (saved) => void onSaved(saved),
    onError: (caught) =>
      setError(apiErrorMessage(caught, "The section could not be saved.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  function toggleProspectiveStaff(publicId: string) {
    setDraft({
      ...draft,
      prospectiveClassStaffPublicIds:
        draft.prospectiveClassStaffPublicIds.includes(publicId)
          ? draft.prospectiveClassStaffPublicIds.filter((id) => id !== publicId)
          : [...draft.prospectiveClassStaffPublicIds, publicId],
    });
  }

  return (
    <ModalFrame
      id="section-editor-title"
      title={mode === "create" ? "Add Section" : "Edit Section"}
      onClose={onClose}
      busy={save.isPending}
      wide
    >
      <form className="academic-modal-form" onSubmit={submit}>
        {error && <div className="error-box academic-modal-span" role="alert">{error}</div>}
        {optionError && (
          <div className="academic-option-warning academic-modal-span" role="status">
            {optionError}
          </div>
        )}
        <FormField label="Department" required>
          <select className="input" value={draft.departmentId} disabled>
            <option value={department.id}>
              {department.code} - {department.name}
            </option>
          </select>
        </FormField>
        <FormField label="Programme" required>
          <select
            className="input"
            required
            disabled={mode === "edit"}
            value={draft.programmeId}
            onChange={(event) =>
              setDraft({
                ...draft,
                programmeId: event.target.value,
                academicYearId: "",
                studyYear: "",
                semesterId: "",
              })
            }
          >
            <option value="">Select programme...</option>
            {programmes.map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.code} - {programme.name}
              </option>
            ))}
          </select>
          {!programmes.length && <small>No active programmes are available.</small>}
        </FormField>
        <FormField label="Academic Year" required>
          <select
            className="input"
            required
            disabled={mode === "edit" || !draft.programmeId}
            value={draft.academicYearId}
            onChange={(event) =>
              setDraft({
                ...draft,
                academicYearId: event.target.value,
                studyYear: "",
                semesterId: "",
              })
            }
          >
            <option value="">Select academic year...</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}{year.isCurrent ? " (Current)" : ""}
              </option>
            ))}
          </select>
          {!draft.programmeId && <small>Select a programme first.</small>}
        </FormField>
        <FormField label="Study Year" required>
          <select
            className="input"
            required
            disabled={mode === "edit" || !draft.academicYearId}
            value={draft.studyYear}
            onChange={(event) =>
              setDraft({
                ...draft,
                studyYear: event.target.value,
                semesterId: "",
              })
            }
          >
            <option value="">Select study year...</option>
            {studyYears.map((studyYear) => (
              <option key={studyYear} value={studyYear}>
                Year {studyYear}
              </option>
            ))}
          </select>
          {!draft.academicYearId && <small>Select an academic year first.</small>}
        </FormField>
        <FormField label="Semester" required>
          <select
            className="input"
            required
            disabled={mode === "edit" || !draft.studyYear}
            value={draft.semesterId}
            onChange={(event) =>
              setDraft({ ...draft, semesterId: event.target.value })
            }
          >
            <option value="">Select semester...</option>
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                Semester {semester.number} - {semester.name}
              </option>
            ))}
          </select>
          {!draft.studyYear && <small>Select a study year first.</small>}
        </FormField>
        <FormField label="Section Name" required>
          <input
            className="input"
            required
            maxLength={80}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="A, B, C, D..."
          />
          <small>Use a short class name such as A, B, C, D, or E.</small>
        </FormField>
        <FormField label="Maximum Students" required>
          <input
            className="input"
            type="number"
            required
            min={Math.max(1, section ? sectionCapacity(section).current : 1)}
            max={70}
            value={draft.capacity}
            onChange={(event) =>
              setDraft({ ...draft, capacity: event.target.value })
            }
          />
          {section && (
            <small>
              Cannot be lower than {sectionCapacity(section).current} active students.
            </small>
          )}
        </FormField>
        <FormField label="Assigned Classroom">
          <select
            className="input"
            value={draft.assignedRoomId}
            onChange={(event) =>
              setDraft({ ...draft, assignedRoomId: event.target.value })
            }
          >
            <option value="">Not assigned</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.code} - {room.name}
              </option>
            ))}
            {section?.assignedRoom &&
              !rooms.some((room) => room.id === section.assignedRoomId) && (
                <option value={section.assignedRoomId ?? ""}>
                  {section.assignedRoom.code} - {section.assignedRoom.name}
                </option>
              )}
          </select>
        </FormField>
        <FormField label="Class Coordinator">
          <select
            className="input"
            value={draft.coordinatorPublicId}
            disabled={
              !draft.isActive && !draft.coordinatorPublicId
            }
            onChange={(event) =>
              setDraft({ ...draft, coordinatorPublicId: event.target.value })
            }
          >
            <option value="">Not assigned</option>
            {staffCandidates.map((candidate) => (
              <option key={candidate.publicId} value={candidate.publicId}>
                {candidate.fullName} ({candidate.collegeIdentityId})
              </option>
            ))}
            {section?.coordinatorAssignments[0] &&
              !staffCandidates.some(
                (candidate) =>
                  candidate.publicId ===
                  section.coordinatorAssignments[0]?.coordinator.publicId,
              ) && (
                <option
                  value={
                    section.coordinatorAssignments[0].coordinator.publicId
                  }
                >
                  {section.coordinatorAssignments[0].coordinator.fullName}
                </option>
              )}
          </select>
          {!draft.isActive && !draft.coordinatorPublicId ? (
            <small>Activate the new section before assigning a coordinator.</small>
          ) : null}
        </FormField>
        <fieldset className="academic-staff-picker academic-modal-span">
          <legend>Prospective Class Staff</legend>
          <p>Select any faculty or staff who may support this class.</p>
          <div className="academic-staff-options">
              {prospectiveCandidates.map((candidate) => (
                <label key={candidate.publicId}>
                  <input
                    type="checkbox"
                    disabled={
                      (!draft.isActive &&
                        !draft.prospectiveClassStaffPublicIds.includes(
                          candidate.publicId,
                        )) ||
                      (!draft.prospectiveClassStaffPublicIds.includes(
                        candidate.publicId,
                      ) &&
                        draft.prospectiveClassStaffPublicIds.length >= 20)
                    }
                    checked={draft.prospectiveClassStaffPublicIds.includes(
                      candidate.publicId,
                    )}
                    onChange={() => toggleProspectiveStaff(candidate.publicId)}
                  />
                  <span>
                    <strong>{candidate.fullName}</strong>
                    <small>
                      {candidate.collegeIdentityId}
                      {candidate.roles.length
                        ? ` - ${candidate.roles.map(({ role }) => role.name).join(", ")}`
                        : " - Staff"}
                    </small>
                  </span>
                </label>
              ))}
              {!prospectiveCandidates.length && (
                <span className="muted">No active staff options are available.</span>
              )}
          </div>
          <small>
            {draft.prospectiveClassStaffPublicIds.length} of 20 selected
          </small>
        </fieldset>
        <label className="academic-check-field academic-modal-span">
          <input
            type="checkbox"
            checked={draft.isActive}
            disabled={mode === "edit" || Boolean(section?.archivedAt)}
            onChange={(event) =>
              setDraft({
                ...draft,
                isActive: event.target.checked,
                ...(!event.target.checked
                  ? {
                      coordinatorPublicId: "",
                      prospectiveClassStaffPublicIds: [],
                    }
                  : {}),
              })
            }
          />
          Active and selectable for new students
          {mode === "edit" ? " (use lifecycle actions to change status)" : ""}
        </label>
        <ModalActions onClose={onClose} busy={save.isPending} label={mode === "create" ? "Create Section" : "Save Changes"} />
      </form>
    </ModalFrame>
  );
}

function SectionViewDialog({
  section,
  onClose,
}: {
  section: AdminSection;
  onClose: () => void;
}) {
  const capacity = sectionCapacity(section);
  return (
    <ModalFrame
      id="section-view-title"
      title={`${section.name} details`}
      onClose={onClose}
    >
      <dl className="academic-section-detail-list">
        <DetailRow label="Code" value={section.code} />
        <DetailRow label="Programme" value={section.semester.programme.name} />
        <DetailRow label="Academic year" value={section.semester.academicYear.name} />
        <DetailRow label="Study year" value={section.studyYear ? `Year ${section.studyYear}` : "Not set"} />
        <DetailRow label="Capacity" value={`${capacity.current} / ${capacity.maximum}`} />
        <DetailRow label="Available seats" value={String(capacity.available)} />
        <DetailRow label="Classroom" value={section.assignedRoom ? `${section.assignedRoom.code} - ${section.assignedRoom.name}` : "Not assigned"} />
        <DetailRow label="Coordinator" value={section.coordinatorAssignments[0]?.coordinator.fullName ?? "Not assigned"} />
        <DetailRow
          label="Prospective staff"
          value={
            section.staffAssignments
              .filter(
                (assignment) =>
                  assignment.assignmentType === "PROSPECTIVE_CLASS_STAFF",
              )
              .map(({ staff }) => staff.fullName)
              .join(", ") || "Not assigned"
          }
        />
        <DetailRow label="Attendance sessions" value={String(section._count.attendanceSessions)} />
        <DetailRow label="Status" value={section.archivedAt ? "Archived" : section.isActive ? "Active" : "Inactive"} />
      </dl>
      <div className="academic-modal-actions">
        <button className="avs-btn avs-btn-primary" type="button" onClick={onClose}>Close</button>
      </div>
    </ModalFrame>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LifecycleDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: LifecycleTarget;
  onClose: () => void;
  onCompleted: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const label = target.kind === "department" ? "department" : "section";
  const actionLabel =
    target.action.charAt(0).toLocaleUpperCase() + target.action.slice(1);
  const mutate = useMutation({
    mutationFn: async () => {
      const base = `/academic/${target.kind}s/${target.id}`;
      if (target.action === "archive") {
        if (reason.trim().length < 3) {
          throw new Error("Enter an archive reason with at least 3 characters.");
        }
        return api.post(`${base}/archive`, { reason: reason.trim() });
      }
      if (target.action === "restore") return api.post(`${base}/restore`);
      return api.patch(base, { isActive: target.action === "activate" });
    },
    onSuccess: () =>
      void onCompleted(
        `${target.name} was ${
          target.action === "activate"
            ? "activated"
            : target.action === "deactivate"
              ? "deactivated"
              : target.action === "archive"
                ? "archived"
                : "restored"
        }.`,
      ),
    onError: (caught) =>
      setError(apiErrorMessage(caught, `The ${label} could not be ${target.action}d.`)),
  });

  const description =
    target.action === "archive"
      ? `Archiving this ${label} removes it from active academic selection while preserving all historical records.`
      : target.action === "deactivate"
        ? `New records cannot select this ${label} while it is inactive. Existing records are preserved.`
        : target.action === "restore"
          ? `Restore this archived ${label} to active academic setup.`
          : `Activate this ${label} so it can be used again.`;

  return (
    <ConfirmationDialog
      open
      onClose={onClose}
      onConfirm={() => {
        setError("");
        mutate.mutate();
      }}
      title={`${actionLabel} ${target.name}`}
      description={description}
      confirmLabel={`${actionLabel} ${label}`}
      variant={target.action === "archive" ? "warning" : "default"}
      loading={mutate.isPending}
    >
      {target.action === "archive" && (
        <label className="field academic-lifecycle-reason">
          <span>Reason for archiving</span>
          <textarea
            className="input"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      )}
      {error && <div className="error-box academic-dialog-error" role="alert">{error}</div>}
    </ConfirmationDialog>
  );
}

function DependenciesDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: EntityTarget;
  onClose: () => void;
  onDeleted: (message: string) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const report = useQuery({
    queryKey: [...workspaceQueryKey, target.kind, target.id, "dependencies"],
    queryFn: () =>
      api.get<DependencyReport>(
        `/academic/${target.kind}s/${target.id}/dependencies`,
      ),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/academic/${target.kind}s/${target.id}`),
    onSuccess: () =>
      void onDeleted(`${target.name} was permanently deleted safely.`),
    onError: (caught) =>
      setError(apiErrorMessage(caught, "Safe deletion could not be completed.")),
  });
  const entity = report.data?.department ?? report.data?.section;
  const dependencies = positiveDependencies(report.data?.dependencies ?? {});
  const confirmed = confirmation.trim() === target.code;

  return (
    <ModalFrame
      id="academic-dependencies-title"
      title={`${target.name} dependencies`}
      onClose={onClose}
      busy={remove.isPending}
      wide
    >
      {report.isLoading && <LoadingState rows={5} />}
      {report.isError && (
        <ErrorState
          message={apiErrorMessage(report.error, "Dependencies could not be analysed.")}
          onRetry={() => void report.refetch()}
        />
      )}
      {report.data && entity && (
        <div className="academic-dependency-content">
          <div className={`academic-dependency-summary${report.data.canDelete ? " can-delete" : ""}`}>
            <Database size={21} />
            <div>
              <strong>{report.data.dependencyCount} dependent records found</strong>
              <p>
                {report.data.canDelete
                  ? "The archived record has no remaining dependencies and can be deleted safely."
                  : !entity.archivedAt
                    ? "Archive this record before requesting permanent deletion."
                    : "Dependencies must be preserved. Keep this record archived rather than deleting it."}
              </p>
            </div>
          </div>
          {dependencies.length > 0 && (
            <div className="academic-dependency-table-wrap">
              <table className="avs-table">
                <thead>
                  <tr><th>Dependency</th><th>Records</th><th>Safe action</th></tr>
                </thead>
                <tbody>
                  {dependencies.map((dependency) => (
                    <tr key={dependency.key}>
                      <td>{dependency.label}</td>
                      <td>{dependency.count}</td>
                      <td><span className="avs-badge avs-badge-neutral">Preserve</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.data.canDelete && (
            <label className="field academic-delete-confirmation">
              <span>
                Type <strong>{target.code}</strong> to confirm permanent deletion
              </span>
              <input
                className="input avs-confirm-input"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="academic-modal-actions">
            <button className="avs-btn avs-btn-secondary" type="button" onClick={onClose} disabled={remove.isPending}>Close</button>
            {report.data.canDelete && (
              <button
                className="avs-btn avs-btn-danger"
                type="button"
                disabled={!confirmed || remove.isPending}
                onClick={() => {
                  setError("");
                  remove.mutate();
                }}
              >
                <Trash2 size={16} />
                {remove.isPending ? "Deleting..." : "Permanently Delete"}
              </button>
            )}
          </div>
        </div>
      )}
    </ModalFrame>
  );
}

function ModalFrame({
  id,
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className="avs-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={`avs-dialog academic-workspace-dialog${wide ? " academic-workspace-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header className="avs-dialog-header">
          <h2 id={id}>{title}</h2>
          <button
            className="avs-btn avs-btn-ghost avs-btn-icon"
            type="button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="avs-dialog-body academic-workspace-dialog-body">
          {children}
        </div>
      </section>
    </div>
  );
}

function FormField({
  label,
  children,
  required = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}{required ? " *" : ""}</span>
      {children}
    </label>
  );
}

function ModalActions({
  onClose,
  busy,
  label,
}: {
  onClose: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <div className="academic-modal-actions academic-modal-span">
      <button className="avs-btn avs-btn-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="avs-btn avs-btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving..." : label}
      </button>
    </div>
  );
}

function emptySection(): WorkspaceSection {
  return {
    id: "",
    semesterId: "",
    code: "",
    name: "",
    capacity: 70,
    isActive: true,
    semester: {
      programme: { id: "", name: "" },
      academicYear: { id: "", name: "" },
    },
  };
}

function apiErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    return caught.requestId
      ? `${caught.message} Reference: ${caught.requestId}.`
      : caught.message;
  }
  return caught instanceof Error ? caught.message : fallback;
}
