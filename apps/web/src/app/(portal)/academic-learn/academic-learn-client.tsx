"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileQuestion,
  FileText,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Subject {
  id: string;
  code: string;
  name: string;
  semester: {
    number: number;
    programme: { name: string; department: { code: string; name: string } };
  };
}

interface Resource {
  id: string;
  title: string;
  description: string | null;
  unitOrModule: string | null;
  resourceType: string;
  mimeType: string;
  fileSize: string;
  status: string;
  allowDownload: boolean;
  publishAt: string | null;
  uploadedBy: { fullName: string };
  _count: { views: number };
}

interface ResourceResponse {
  courseResources: Array<{
    id: string;
    title: string;
    type: string;
    url: string;
  }>;
  subjectResources: Resource[];
}

interface ModelPaper {
  id: string;
  title: string;
  examType: string;
  maximumMarks: number | null;
  durationMinutes: number | null;
  publishAt: string | null;
  uploadedBy: { fullName: string };
}

const uploadTypes = [
  "SUBJECT_NOTES",
  "UNIT_NOTES",
  "LECTURE_PDF",
  "PRESENTATION",
  "PREVIOUS_YEAR_QUESTION_PAPER",
  "QUESTION_BANK",
  "LABORATORY_MANUAL",
  "PROGRAMMING_EXERCISE",
  "ASSIGNMENT",
  "REFERENCE_MATERIAL",
  "SYLLABUS_COPY",
];

export function AcademicLearnClient() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const canUpload = user?.roles.some((role) =>
    ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "FACULTY"].includes(role),
  );
  const subjects = useQuery({
    queryKey: ["academic-learn", "subjects"],
    queryFn: () => api.get<Subject[]>("/learn/subjects"),
  });
  const selectedSubject =
    subjects.data?.find((subject) => subject.id === selectedSubjectId) ??
    subjects.data?.[0];
  const resources = useQuery({
    queryKey: ["academic-learn", "resources", selectedSubject?.id],
    queryFn: () =>
      api.get<ResourceResponse>(
        `/learn/subjects/${selectedSubject!.id}/resources`,
      ),
    enabled: Boolean(selectedSubject?.id),
  });
  const papers = useQuery({
    queryKey: ["academic-learn", "model-papers", selectedSubject?.id],
    queryFn: () =>
      api.get<ModelPaper[]>(
        `/learn/model-papers?subjectId=${selectedSubject!.id}`,
      ),
    enabled: Boolean(selectedSubject?.id),
  });
  const filtered = useMemo(() => {
    const token = search.trim().toLowerCase();
    if (!token) return resources.data?.subjectResources ?? [];
    return (resources.data?.subjectResources ?? []).filter((resource) =>
      [resource.title, resource.description, resource.unitOrModule, resource.resourceType]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(token)),
    );
  }, [resources.data, search]);
  const download = useMutation({
    mutationFn: async (resource: Resource) => {
      const result = await api.get<{ url: string }>(
        `/learn/resources/${resource.id}/download`,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    },
  });

  if (subjects.isLoading) return <LoadingState />;
  if (subjects.isError) return <ErrorState message="Academic subjects could not be loaded." />;
  if (!subjects.data?.length)
    return <EmptyState title="No assigned subjects" message="Academic resources appear after profile verification and subject assignment." />;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Academic resources</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>AVS Learn Portal</h1>
          <p className="page-subtitle">{selectedSubject?.semester.programme.department.name}</p>
        </div>
        <button className="icon-button" aria-label="Refresh resources" onClick={() => void client.invalidateQueries({ queryKey: ["academic-learn"] })}>
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="dashboard-grid">
        <aside>
          <label className="field">
            <span>Subject</span>
            <select
              className="input"
              value={selectedSubject?.id ?? ""}
              onChange={(event) => setSelectedSubjectId(event.target.value)}
            >
              {subjects.data.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code} - {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Search resources</span>
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {canUpload && (
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowUpload(true)}>
              <Upload size={17} />
              Upload resource
            </button>
          )}
        </aside>

        <section>
          {resources.isLoading ? <LoadingState /> : resources.isError ? <ErrorState /> : (
            <>
              <div className="section-head">
                <div>
                  <h2>Learning resources</h2>
                  <p>{filtered.length} available</p>
                </div>
              </div>
              <div className="issue-list">
                {filtered.map((resource) => (
                  <div key={resource.id}>
                    <span className="list-icon"><FileText size={18} /></span>
                    <span className="list-copy">
                      <strong>{resource.title}</strong>
                      <small>{resource.resourceType.replaceAll("_", " ")}{resource.unitOrModule ? ` · ${resource.unitOrModule}` : ""} · {resource.uploadedBy.fullName}</small>
                    </span>
                    <button className="icon-button" aria-label={`Open ${resource.title}`} onClick={() => download.mutate(resource)}>
                      <Download size={17} />
                    </button>
                  </div>
                ))}
                {!filtered.length && <div className="empty">No resources match this subject and search.</div>}
              </div>
            </>
          )}
          <div className="section-head" style={{ marginTop: 24 }}>
            <div>
              <h2>Model question papers</h2>
              <p>{papers.data?.length ?? 0} available</p>
            </div>
          </div>
          <div className="issue-list">
            {papers.data?.map((paper) => (
              <div key={paper.id}>
                <span className="list-icon"><FileQuestion size={18} /></span>
                <span className="list-copy">
                  <strong>{paper.title}</strong>
                  <small>{paper.examType.replaceAll("_", " ")}{paper.maximumMarks ? ` · ${paper.maximumMarks} marks` : ""}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Download ${paper.title}`}
                  onClick={async () => {
                    const result = await api.get<{ url: string }>(`/learn/model-papers/${paper.id}/download`);
                    window.open(result.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Download size={17} />
                </button>
              </div>
            ))}
            {!papers.data?.length && <div className="empty">No model papers are published for this subject.</div>}
          </div>
        </section>
      </div>

      {showUpload && selectedSubject && (
        <UploadDialog
          subject={selectedSubject}
          error={uploadError}
          onClose={() => {
            setShowUpload(false);
            setUploadError("");
          }}
          onError={setUploadError}
          onUploaded={() => {
            setShowUpload(false);
            setUploadError("");
            void client.invalidateQueries({ queryKey: ["academic-learn", "resources", selectedSubject.id] });
          }}
        />
      )}
    </>
  );
}

function UploadDialog({
  subject,
  error,
  onClose,
  onError,
  onUploaded,
}: {
  subject: Subject;
  error: string;
  onClose: () => void;
  onError: (message: string) => void;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return onError("Select a file.");
    setBusy(true);
    onError("");
    try {
      const presign = await api.post<{ storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>(
        `/staff/learn/subjects/${subject.id}/resources/presign`,
        { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
      );
      const upload = await fetch(presign.uploadUrl, { method: "PUT", headers: presign.requiredHeaders, body: file });
      if (!upload.ok) throw new Error("Secure file upload failed.");
      await api.post(`/staff/learn/subjects/${subject.id}/resources/complete`, {
        storageKey: presign.storageKey,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
        unitOrModule: String(form.get("unitOrModule") ?? ""),
        resourceType: String(form.get("resourceType") ?? "SUBJECT_NOTES"),
        status: form.get("publish") === "on" ? "PUBLISHED" : "DRAFT",
        notifyStudents: form.get("notify") === "on",
        allowDownload: true,
      });
      onUploaded();
    } catch (caught) {
      onError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Resource upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-label="Upload subject resource">
        <div className="section-head">
          <div><h2>Upload to {subject.code}</h2><p>{subject.name}</p></div>
          <button className="icon-button" aria-label="Close upload" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <label className="field"><span>Resource title</span><input className="input" name="title" required maxLength={180} /></label>
          <label className="field"><span>Description</span><textarea className="input" name="description" maxLength={1000} /></label>
          <label className="field"><span>Unit or module</span><input className="input" name="unitOrModule" maxLength={120} /></label>
          <label className="field"><span>Resource type</span><select className="input" name="resourceType">{uploadTypes.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className="field"><span>File</span><input className="input" name="file" type="file" required accept=".pdf,.doc,.docx,.ppt,.pptx,.txt" /></label>
          <label className="check-field"><input type="checkbox" name="publish" /> Publish now</label>
          <label className="check-field"><input type="checkbox" name="notify" /> Notify verified students</label>
          {error && <div className="error-box">{error}</div>}
          <div className="button-row"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}><Upload size={16} />{busy ? "Uploading..." : "Upload"}</button></div>
        </form>
      </section>
    </div>
  );
}
