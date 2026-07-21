"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, CloudOff, Save, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError, idempotencyKey } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface RosterRow {
  recordId?: string;
  userId: string;
  publicId: string;
  studentId: string;
  rollNumber: string | null;
  fullName: string;
  status: string | null;
  note: string | null;
}

interface RosterResponse {
  session: { id: string; status: string; submittedAt: string | null; lockedAt: string | null; version: number };
  students: RosterRow[];
}

interface AttendanceMarkingPanelProps {
  sessionId: string;
  embedded?: boolean;
  onClose?: () => void;
  onSubmitted?: () => void;
}

const statuses = [
  { value: "PRESENT", short: "P", className: "present" },
  { value: "ABSENT", short: "A", className: "absent" },
  { value: "LATE", short: "L", className: "late" },
  { value: "ON_DUTY", short: "OD", className: "duty" },
  { value: "MEDICAL_LEAVE", short: "ML", className: "leave" },
  { value: "AUTHORIZED_LEAVE", short: "AL", className: "leave" },
];

export function AttendanceMarkingPanel({ sessionId, embedded = false, onClose, onSubmitted }: AttendanceMarkingPanelProps) {
  const router = useRouter();
  const client = useQueryClient();
  const { user } = useAuth();
  const draftKey = user ? `attendance-draft:${user.id}:${sessionId}` : null;
  const submissionKey = useRef(idempotencyKey());
  const [records, setRecords] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined" || !draftKey) return {};
    localStorage.removeItem(`attendance-draft:${sessionId}`);
    const stored = localStorage.getItem(draftKey);
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as { expiresAt?: number; records?: Record<string, string> };
      if (!parsed.expiresAt || parsed.expiresAt < Date.now() || !parsed.records) {
        localStorage.removeItem(draftKey);
        return {};
      }
      return parsed.records;
    } catch {
      localStorage.removeItem(draftKey);
      return {};
    }
  });
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["attendance-roster", sessionId],
    queryFn: () => api.get<RosterResponse>(`/attendance/sessions/${sessionId}/roster`),
  });
  const payload = () => ({
    expectedVersion: query.data?.session.version ?? 0,
    records: query.data?.students.map((row) => ({
      studentUserId: row.userId,
      status: records[row.userId] ?? row.status ?? "PRESENT",
    })) ?? [],
  });
  const save = useMutation({
    mutationFn: () => api.put<{ savedAt: string; version: number }>(`/attendance/sessions/${sessionId}/draft`, payload()),
    onSuccess: (result) => {
      setSavedAt(result.savedAt);
      if (draftKey) localStorage.removeItem(draftKey);
      void query.refetch();
      void client.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: handleError,
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/attendance/sessions/${sessionId}/submit`, payload(), { "Idempotency-Key": submissionKey.current }),
    onSuccess: () => {
      submissionKey.current = idempotencyKey();
      if (draftKey) localStorage.removeItem(draftKey);
      void client.invalidateQueries({ queryKey: ["attendance-sessions"] });
      onSubmitted?.();
      if (!embedded) router.push("/attendance");
      else void query.refetch();
    },
    onError: handleError,
  });
  const correction = useMutation({
    mutationFn: ({ recordId, requestedStatus, reason }: { recordId: string; requestedStatus: string; reason: string }) =>
      api.post(`/attendance/sessions/${sessionId}/corrections`, { recordId, requestedStatus, reason }),
    onSuccess: () => setSavedAt("Correction submitted"),
    onError: handleError,
  });

  useEffect(() => {
    if (!draftKey || !Object.keys(records).length || query.data?.session.status !== "DRAFT") return;
    localStorage.setItem(draftKey, JSON.stringify({ expiresAt: Date.now() + 24 * 60 * 60_000, records }));
  }, [records, draftKey, query.data?.session.status]);

  function handleError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.message : "Attendance could not be saved.");
  }

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message="This session is not available in your assigned scope." />;

  const roster = query.data;
  const permissions = user?.permissions ?? [];
  const canEditSubmitted =
    roster.session.status === "SUBMITTED" &&
    permissions.includes("attendance.edit_window") &&
    permissions.includes("attendance.mark") &&
    permissions.includes("attendance.submit");
  const canMarkDraft = roster.session.status === "DRAFT" && permissions.includes("attendance.mark");
  const canDirectEdit = canMarkDraft || canEditSubmitted;
  const canSaveDraft = roster.session.status === "DRAFT" && permissions.includes("attendance.mark");
  const canSubmitDraft = roster.session.status === "DRAFT" && permissions.includes("attendance.submit");
  const canSubmit = (canSubmitDraft || canEditSubmitted) && roster.students.length > 0;
  const canRequestCorrection = !canDirectEdit && permissions.includes("attendance.correction.request");
  const present = roster.students.filter((row) => !["ABSENT", "MEDICAL_LEAVE"].includes(records[row.userId] ?? row.status ?? "PRESENT")).length;
  const statusLabel = roster.session.status.replaceAll("_", " ");

  function choose(student: RosterRow, status: string) {
    if (canDirectEdit) {
      setRecords((value) => ({ ...value, [student.userId]: status }));
      return;
    }
    if (!student.recordId || !canRequestCorrection) return;
    const reason = window.prompt(`Reason to change ${student.fullName} to ${status.replaceAll("_", " ")}:`);
    if (reason && reason.trim().length >= 5) correction.mutate({ recordId: student.recordId, requestedStatus: status, reason: reason.trim() });
  }

  function markAll(status: string) {
    setRecords(Object.fromEntries(roster.students.map((row) => [row.userId, status])));
  }

  return (
    <>
      <div className={embedded ? "section-title" : "page-heading"}>
        <div>
          {!embedded && (
            <Link href="/attendance" style={{ color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center", minHeight: "auto", marginBottom: 9 }}>
              <ArrowLeft size={16} />
              Attendance
            </Link>
          )}
          <h1 className={embedded ? undefined : "page-title"}>{canDirectEdit ? "Mark attendance" : "Attendance record"}</h1>
          <p className="page-subtitle">{roster.students.length} students - {present} currently counted as attended - {statusLabel}</p>
        </div>
        <div className="button-row">
          {canDirectEdit && (
            <>
              <button type="button" className="btn btn-secondary" disabled={!roster.students.length} onClick={() => markAll("PRESENT")}>
                <CheckCheck size={17} />
                Mark all present
              </button>
              <button type="button" className="btn btn-secondary" disabled={!roster.students.length} onClick={() => markAll("ABSENT")}>
                <XCircle size={17} />
                Mark all absent
              </button>
              {canSaveDraft && (
                <button type="button" className="btn btn-secondary" disabled={save.isPending || !roster.students.length} onClick={() => { setError(""); save.mutate(); }}>
                  <CloudOff size={17} />
                  {save.isPending ? "Saving..." : "Save draft"}
                </button>
              )}
              <button type="button" className="btn btn-primary" disabled={submit.isPending || !canSubmit} onClick={() => { setError(""); submit.mutate(); }}>
                <Save size={17} />
                {submit.isPending ? "Submitting..." : canEditSubmitted ? "Update attendance" : "Submit attendance"}
              </button>
            </>
          )}
          {embedded && onClose && (
            <button type="button" className="icon-button" aria-label="Close attendance panel" onClick={onClose}>
              <X size={17} />
            </button>
          )}
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      {savedAt && <div className="card" style={{ padding: 12, marginBottom: 14, color: "var(--success)" }}>{savedAt === "Correction submitted" ? savedAt : `Draft saved to the server at ${new Date(savedAt).toLocaleTimeString()}.`}</div>}
      {!canDirectEdit && <div className="card" style={{ padding: 12, marginBottom: 14 }}>{canRequestCorrection ? "Select a different status to submit an auditable correction request." : "This attendance record is read-only for your account."}</div>}
      {canEditSubmitted && <div className="card" style={{ padding: 12, marginBottom: 14 }}>This submitted session is still inside the admin edit window. Updates will be saved with audit history.</div>}
      <div className="card roster">
        <div className="roster-legend">{statuses.map((status) => <span key={status.value}><i className={status.className}>{status.short}</i>{status.value.replaceAll("_", " ")}</span>)}</div>
        {!roster.students.length ? <div className="empty">No students in this class yet. Add students from the Attendance page before submitting.</div> : roster.students.map((student, index) => <div className="student-row" key={student.userId}><span className="row-number">{index + 1}</span><span className="avatar">{student.fullName[0]}</span><span className="student-name"><strong>{student.fullName}</strong><small>{student.rollNumber ?? student.studentId}</small></span><div className="status-buttons">{statuses.map((status) => <button type="button" disabled={!canDirectEdit && (!student.recordId || !canRequestCorrection)} aria-label={`${student.fullName}: ${status.value.replaceAll("_", " ")}`} title={canDirectEdit ? status.value.replaceAll("_", " ") : `Request ${status.value.replaceAll("_", " ")}`} className={`${status.className} ${(records[student.userId] ?? student.status ?? "PRESENT") === status.value ? "selected" : ""}`} key={status.value} onClick={() => choose(student, status.value)}>{status.short}</button>)}</div></div>)}
      </div>
    </>
  );
}
