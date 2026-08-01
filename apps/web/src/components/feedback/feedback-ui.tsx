"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import {
  AlertTriangle,
  Archive,
  BarChart2,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FileText,
  History,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  ToggleLeft,
  ToggleRight,
  UserRound,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import {
  acquireDecodeLock,
  cameraAccessGuidance,
  extractFeedbackToken,
  resetDecodeLock,
  safeFeedbackPhotoSource,
  type CameraAccessGuidance,
} from "@/components/feedback/feedback-helpers";
import { api, ApiError, idempotencyKey } from "@/lib/api";
import type { PageResponse, SelectOption } from "@/lib/types";

type TargetType =
  | "STAFF"
  | "HOD"
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "DEPARTMENT"
  | "BUILDING"
  | "BLOCK"
  | "FLOOR"
  | "CLASSROOM"
  | "LABORATORY"
  | "LIBRARY"
  | "CANTEEN"
  | "TRANSPORT"
  | "MAINTENANCE"
  | "SECURITY"
  | "OFFICE"
  | "CAMPUS_SERVICE"
  | "OTHER_SERVICE";

interface FeedbackTarget {
  id: string;
  targetType: TargetType;
  targetName: string;
  description: string | null;
  serviceCode: string | null;
  staff: {
    publicId: string;
    staffId: string;
    name: string;
    designation: string | null;
    department: SelectOption | null;
    profilePhotoKey: string | null;
  } | null;
  department: SelectOption | null;
  campus: SelectOption | null;
  block: SelectOption | null;
  floor: (SelectOption & { level: number }) | null;
  room: (SelectOption & { roomNumber: string | null; roomType: string }) | null;
}

interface FeedbackQuestion {
  id: string;
  category: string;
  questionText: string;
  questionType: string;
  displayOrder: number;
  isRequired: boolean;
}
interface FeedbackLookupResponse {
  qrId?: string;
  target: FeedbackTarget;
  questions: FeedbackQuestion[];
  submissionTicket: string;
  submissionTicketExpiresInSeconds: number;
}
interface SubmitResponse {
  referenceNumber: string;
  status: string;
  priority: string;
  submittedAt: string;
  message: string;
}
interface DashboardSummary {
  totalFeedbackSubmissions: number;
  averageCollegeRating: number;
  totalFacultyRated: number;
  totalStaffRated: number;
  totalBuildingFeedback: number;
  positiveFeedbackCount: number;
  neutralFeedbackCount: number;
  negativeFeedbackCount: number;
  criticalComplaints: number;
  pendingActions: number;
  resolvedIssues: number;
  activeQrCodes: number;
  disabledQrCodes: number;
}
interface DashboardData {
  summary: DashboardSummary;
  ratingDistribution: Array<{ rating: number; count: number }>;
  departmentWise: Array<{ name: string; count: number; averageRating: number }>;
  targetWise: Array<{ name: string; count: number; averageRating: number }>;
  categoryWise: Array<{ name: string; count: number; averageRating: number }>;
  monthlyTrend: Array<{ month: string; count: number; averageRating: number }>;
  sentimentDistribution: Array<{ name: string; count: number }>;
  statusDistribution: Array<{ name: string; count: number }>;
}
interface FeedbackSubmission {
  id: string;
  referenceNumber: string;
  target: FeedbackTarget;
  overallRating: number;
  sentiment: string;
  status: string;
  priority: string;
  submittedAt: string;
  isAnonymous: boolean;
  student: {
    publicId: string;
    collegeIdentityId: string;
    fullName: string;
  } | null;
  comments: {
    positive: string | null;
    improvement: string | null;
    general: string | null;
    complaint: string | null;
  };
}
interface QrRow {
  id: string;
  qrId: string;
  target: FeedbackTarget;
  status: string;
  expiryDate: string | null;
  scanCount: number;
  feedbackCount: number;
  lastScannedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  secureUrl: string;
}
interface StaffAnalytics {
  staff: {
    publicId: string;
    staffId: string;
    name: string;
    designation: string | null;
    department: string | null;
    profilePhotoKey: string | null;
  };
  overallAverageRating: number;
  ratingBadge: string;
  totalFeedbackCount: number;
  categoryRatings: Array<{
    name: string;
    count: number;
    averageRating: number;
  }>;
  monthlyTrend: Array<{ month: string; count: number; averageRating: number }>;
  positiveFeedbackPercentage: number;
  negativeFeedbackPercentage: number;
  attendance: {
    attendancePercentage: number;
    totalWorkingDays: number;
    submittedSessions: number;
    totalSessions: number;
    sourceNote: string;
  };
  comments: Array<{
    referenceNumber: string;
    rating: number;
    submittedAt: string;
    positiveComment: string | null;
    improvementComment: string | null;
    generalComment: string | null;
    complaintText: string | null;
    status: string;
  }>;
}
interface LowAttendanceRow {
  student: {
    publicId: string;
    photoKey: string | null;
    name: string;
    registerNumber: string;
  };
  department: string | null;
  year: number;
  class: string | null;
  section: string | null;
  mobileNumber: string | null;
  parentContact: string | null;
  totalPeriods: number;
  presentPeriods: number;
  absentPeriods: number;
  onDutyPeriods: number;
  leavePeriods: number;
  attendancePercentage: number;
  attendanceStatus: "SAFE" | "WARNING" | "CRITICAL";
  requiredAttendancePercentage: number;
  classesNeededToReachRequiredPercentage: number;
  subjectWiseShortage: Array<{
    subject: { code: string; name: string };
    totalPeriods: number;
    presentPeriods: number;
    attendancePercentage: number;
    shortageClasses: number;
  }>;
  lastAttendanceDate: string | null;
  notificationStatus: string;
}
interface FeedbackSettingsData {
  requiredAttendancePercentage: number;
  attendanceWarningPercentage: number;
  attendanceCriticalPercentage: number;
  defaultSubmissionRule:
    | "ONCE_PER_DAY"
    | "ONCE_PER_WEEK"
    | "ONCE_PER_CYCLE"
    | "UNLIMITED";
  anonymousMode: boolean;
  commentsRequired: boolean;
  staffCanViewComments: boolean;
  studentIdentityVisibleToManagement: boolean;
  negativeFeedbackRequiresInvestigation: boolean;
  emailAlertsEnabled: boolean;
  whatsAppAlertsEnabled: boolean;
}

const COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
];

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError ? caught.message : fallback;
}

function stars(value: number) {
  return Array.from({ length: 5 }, (_, index) => index < value);
}

function ratingColor(value: number) {
  if (value >= 4) return "#15803d";
  if (value >= 3) return "#d97706";
  return "#dc2626";
}

function metricCard(
  label: string,
  value: string | number,
  icon: typeof Star,
  color = "#2563eb",
) {
  const Icon = icon;
  return (
    <article className="card metric-card" key={label}>
      <span
        className="metric-icon"
        style={{
          color,
          background:
            color === "#dc2626"
              ? "#fff1f2"
              : color === "#15803d"
                ? "#f0fdf4"
                : "#eff6ff",
        }}
      >
        <Icon size={21} />
      </span>
      <div>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export function FeedbackScannerPage() {
  const router = useRouter();
  const htmlId = useId().replace(/:/g, "");
  const readerId = `feedback-reader-${htmlId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const decodeLockRef = useRef(false);
  const runningRef = useRef(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState<CameraAccessGuidance | null>(null);
  const [running, setRunning] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>(
    [],
  );
  const [cameraId, setCameraId] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(
    () => () => {
      decodeLockRef.current = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) {
        void scanner
          .stop()
          .catch(() => undefined)
          .finally(() => scanner.clear());
      } else {
        scanner?.clear();
      }
    },
    [],
  );

  async function start(requestedCameraId?: string) {
    if (cameraBusy) return;
    setCameraBusy(true);
    setError("");
    setGuidance(null);
    resetDecodeLock(decodeLockRef);
    try {
      if (!window.isSecureContext)
        throw new DOMException(
          "Camera access requires HTTPS.",
          "SecurityError",
        );
      const devices = cameras.length ? cameras : await Html5Qrcode.getCameras();
      setCameras(devices);
      const selected =
        requestedCameraId ||
        cameraId ||
        devices.find((device) => /back|rear|environment/i.test(device.label))
          ?.id ||
        devices[0]?.id;
      if (!selected) throw new Error("No camera was found.");
      const scanner =
        scannerRef.current ?? new Html5Qrcode(readerId, { verbose: false });
      scannerRef.current = scanner;
      if (scanner.isScanning) await scanner.stop();
      runningRef.current = false;
      setRunning(false);
      setTorchSupported(false);
      setTorchOn(false);
      await scanner.start(
        selected,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (!acquireDecodeLock(decodeLockRef)) return;
          const token = extractFeedbackToken(decodedText);
          if (!token) {
            resetDecodeLock(decodeLockRef);
            setError("This QR code did not contain a feedback token.");
            return;
          }
          runningRef.current = false;
          setRunning(false);
          setTorchSupported(false);
          setTorchOn(false);
          void scanner
            .stop()
            .catch(() => undefined)
            .finally(() => {
              router.push(
                `/feedback/scan/${encodeURIComponent(token)}`,
              );
            });
        },
        () => undefined,
      );
      setCameraId(selected);
      runningRef.current = true;
      setRunning(true);
      try {
        const capabilities =
          scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
        setTorchSupported(capabilities.torch === true);
      } catch {
        setTorchSupported(false);
      }
    } catch (caught) {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop().catch(() => undefined);
      }
      runningRef.current = false;
      setRunning(false);
      setTorchSupported(false);
      setTorchOn(false);
      setGuidance(cameraAccessGuidance(caught, window.isSecureContext));
    } finally {
      setCameraBusy(false);
    }
  }

  async function stop() {
    if (cameraBusy) return;
    setCameraBusy(true);
    await scannerRef.current?.stop().catch(() => undefined);
    runningRef.current = false;
    setRunning(false);
    setTorchSupported(false);
    setTorchOn(false);
    resetDecodeLock(decodeLockRef);
    setCameraBusy(false);
  }

  async function switchCamera(nextCameraId: string) {
    setCameraId(nextCameraId);
    if (runningRef.current) await start(nextCameraId);
  }

  async function toggleTorch() {
    const scanner = scannerRef.current;
    if (!scanner?.isScanning || !torchSupported) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
      setError("");
    } catch {
      setError("The flashlight could not be changed on this camera.");
    }
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const token = extractFeedbackToken(manual);
    if (!token) return;
    if (!acquireDecodeLock(decodeLockRef)) return;
    router.push(`/feedback/scan/${encodeURIComponent(token)}`);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Student feedback</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Scan QR code
          </h1>
          <p className="page-subtitle">
            Open a secure feedback form for a faculty member, room, block or
            campus service.
          </p>
        </div>
        <Link className="btn btn-secondary" href="/student/feedback/history">
          <History size={17} />
          History
        </Link>
      </div>
      <section className="feedback-scanner-grid">
        <div className="card scanner-panel">
          <div className="scanner-frame">
            <div id={readerId} />
            {!running && (
              <div className="scanner-idle">
                <Camera size={30} />
                <strong>Camera is off</strong>
                <span>Select Start camera when you are ready to scan.</span>
              </div>
            )}
          </div>
          {error && <div className="error-box">{error}</div>}
          {guidance && (
            <div className="camera-guidance" role="alert">
              <strong>{guidance.title}</strong>
              <p>{guidance.message}</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cameraBusy}
                onClick={() => void start(cameraId || undefined)}
              >
                <RefreshCw size={16} />
                Try again
              </button>
            </div>
          )}
          <div className="button-row" style={{ justifyContent: "flex-start" }}>
            {!running ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={cameraBusy}
                onClick={() => void start()}
              >
                <Camera size={18} />
                {cameraBusy ? "Starting..." : "Start camera"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cameraBusy}
                onClick={() => void stop()}
              >
                <Camera size={18} />
                Stop camera
              </button>
            )}
            {cameras.length > 1 && (
              <select
                aria-label="Camera"
                className="input scanner-camera"
                disabled={cameraBusy}
                value={cameraId}
                onChange={(event) => void switchCamera(event.target.value)}
              >
                {cameras.map((camera, index) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}
            {running && torchSupported && (
              <button
                type="button"
                className="btn btn-secondary"
                aria-pressed={torchOn}
                onClick={() => void toggleTorch()}
              >
                {torchOn ? <ZapOff size={17} /> : <Zap size={17} />}
                {torchOn ? "Flashlight off" : "Flashlight on"}
              </button>
            )}
          </div>
        </div>
        <aside className="card scanner-side">
          <form onSubmit={submitManual} className="manual-code-form">
            <div className="section-head">
              <div>
                <h2>Manual code</h2>
                <p>Use this when the camera cannot scan clearly.</p>
              </div>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              <label className="field">
                <span>QR token or URL</span>
                <input
                  className="input"
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  placeholder="FB_..."
                />
              </label>
              <button className="btn btn-primary">
                <Search size={17} />
                Open form
              </button>
            </div>
          </form>
          <TargetSearch />
        </aside>
      </section>
    </>
  );
}

function TargetSearch() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["feedback-target-search", search],
    queryFn: () =>
      api.get<FeedbackTarget[]>(
        `/feedback/targets?search=${encodeURIComponent(search)}`,
      ),
    enabled: search.trim().length >= 2,
  });
  return (
    <div className="target-search-panel">
      <div className="section-head">
        <div>
          <h2>Find target</h2>
          <p>Search by name, staff ID, department or service.</p>
        </div>
      </div>
      <div style={{ padding: 18, display: "grid", gap: 12 }}>
        <label className="field">
          <span>Search</span>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {query.isLoading && <LoadingState rows={2} />}
        {query.data?.map((target) => (
          <Link
            href={`/student/feedback/form/${target.id}`}
            className="target-result"
            key={target.id}
          >
            <strong>{target.targetName}</strong>
            <small>
              {target.targetType.replaceAll("_", " ")}
              {target.department ? ` - ${target.department.name}` : ""}
            </small>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function FeedbackTargetRoutePage() {
  const params = useParams<{ token: string }>();
  return <FeedbackForm lookup="qr" value={params.token} />;
}

export function FeedbackTargetFormRoutePage() {
  const params = useParams<{ targetId: string }>();
  return <FeedbackForm lookup="target" value={params.targetId} />;
}

function FeedbackTargetAvatar({
  target,
  compact = false,
}: {
  target: FeedbackTarget;
  compact?: boolean;
}) {
  const [failedPhotoSource, setFailedPhotoSource] = useState<string | null>(
    null,
  );
  const photoSource = safeFeedbackPhotoSource(target.staff?.profilePhotoKey);
  const name = target.staff?.name ?? target.targetName;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const size = compact ? 48 : 72;
  return (
    <span className={`feedback-target-avatar${compact ? " compact" : ""}`}>
      {photoSource && failedPhotoSource !== photoSource ? (
        <Image
          src={photoSource}
          alt={`${name} profile`}
          width={size}
          height={size}
          unoptimized
          onError={() => setFailedPhotoSource(photoSource)}
        />
      ) : (
        initials || <UserRound size={compact ? 22 : 30} aria-hidden="true" />
      )}
    </span>
  );
}

function FeedbackForm({
  lookup,
  value,
}: {
  lookup: "qr" | "target";
  value: string;
}) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState({
    positiveComment: "",
    improvementComment: "",
    generalComment: "",
    complaintText: "",
    isAnonymous: true,
  });
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["feedback-lookup", lookup, value],
    queryFn: () =>
      lookup === "qr"
        ? api.get<FeedbackLookupResponse>(
            `/feedback/qr/${encodeURIComponent(value)}/resolve`,
          )
        : api.get<FeedbackLookupResponse>(
            `/feedback/targets/${encodeURIComponent(value)}`,
          ),
    retry: false,
  });
  const overall = useMemo(() => {
    const values = Object.values(ratings).filter((value) => value > 0);
    return values.length
      ? Math.round(
          values.reduce((sum, value) => sum + value, 0) / values.length,
        )
      : 0;
  }, [ratings]);
  const submit = useMutation({
    mutationFn: () =>
      api.post<SubmitResponse>(
        lookup === "qr"
          ? `/feedback/qr/${encodeURIComponent(value)}/submit`
          : "/feedback/submit",
        {
          ...(lookup === "target"
            ? {
                submissionTicket: query.data?.submissionTicket,
                targetId: query.data?.target.id,
              }
            : {}),
          ratings: Object.entries(ratings)
            .filter(([, rating]) => rating > 0)
            .map(([questionId, rating]) => ({ questionId, rating })),
          ...comments,
        },
        { "idempotency-key": idempotencyKey() },
      ),
    onSuccess: (result) =>
      router.replace(`/student/feedback/success/${result.referenceNumber}`),
    onError: (caught) =>
      setError(errorMessage(caught, "Feedback could not be submitted.")),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={errorMessage(
          query.error,
          "This QR code is invalid, expired or disabled.",
        )}
      />
    );
  const { target, questions } = query.data;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (
      !questions.every(
        (question) => !question.isRequired || ratings[question.id],
      )
    ) {
      setError("Please complete all required ratings.");
      return;
    }
    if (window.confirm("Submit this feedback now?")) submit.mutate();
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="page-heading">
        <div className="feedback-target-heading">
          <FeedbackTargetAvatar target={target} />
          <div>
            <span className="eyebrow">
              {target.targetType.replaceAll("_", " ")}
            </span>
            <h1 className="page-title" style={{ marginTop: 6 }}>
              {target.targetName}
            </h1>
            {target.staff ? (
              <div className="feedback-target-meta">
                <span>
                  <strong>Staff ID</strong>
                  {target.staff.staffId}
                </span>
                {target.staff.designation && (
                  <span>
                    <strong>Designation</strong>
                    {target.staff.designation}
                  </span>
                )}
                {target.staff.department && (
                  <span>
                    <strong>Department</strong>
                    {target.staff.department.name}
                  </span>
                )}
              </div>
            ) : (
              <p className="page-subtitle">
                {[
                  target.department?.name,
                  target.block?.name,
                  target.floor?.name,
                  target.room?.roomNumber,
                  target.serviceCode,
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </p>
            )}
          </div>
        </div>
        <div className="rating-pill">
          <Star size={18} fill="currentColor" />
          {overall || "-"}
        </div>
      </div>
      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      <section className="feedback-form-grid">
        <div className="card feedback-question-list">
          <div className="section-head">
            <div>
              <h2>Ratings</h2>
              <p>1 is very poor, 5 is excellent.</p>
            </div>
          </div>
          {questions.map((question) => (
            <div className="rating-row" key={question.id}>
              <span>
                <strong>{question.category}</strong>
                <small>{question.questionText}</small>
              </span>
              <StarRating
                value={ratings[question.id] ?? 0}
                onChange={(rating) =>
                  setRatings((current) => ({
                    ...current,
                    [question.id]: rating,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <aside className="card feedback-comments">
          <div className="section-head">
            <div>
              <h2>Comments</h2>
              <p>Separate appreciation, suggestions and issues.</p>
            </div>
          </div>
          <div style={{ padding: 18, display: "grid", gap: 13 }}>
            <label className="field">
              <span>Positive feedback</span>
              <textarea
                className="input"
                value={comments.positiveComment}
                onChange={(event) =>
                  setComments({
                    ...comments,
                    positiveComment: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Improvement suggestion</span>
              <textarea
                className="input"
                value={comments.improvementComment}
                onChange={(event) =>
                  setComments({
                    ...comments,
                    improvementComment: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>General comments</span>
              <textarea
                className="input"
                value={comments.generalComment}
                onChange={(event) =>
                  setComments({
                    ...comments,
                    generalComment: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Complaint or issue</span>
              <textarea
                className="input"
                value={comments.complaintText}
                onChange={(event) =>
                  setComments({
                    ...comments,
                    complaintText: event.target.value,
                  })
                }
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={comments.isAnonymous}
                onChange={(event) =>
                  setComments({
                    ...comments,
                    isAnonymous: event.target.checked,
                  })
                }
              />
              Submit anonymously where permitted
            </label>
            <button
              className="btn btn-primary"
              disabled={submit.isPending || overall === 0}
            >
              <Send size={17} />
              {submit.isPending ? "Submitting..." : "Submit feedback"}
            </button>
          </div>
        </aside>
      </section>
    </form>
  );
}

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="star-rating">
      {stars(5).map((_filled, index) => {
        const rating = index + 1;
        return (
          <button
            type="button"
            key={rating}
            onClick={() => onChange(rating)}
            aria-label={`${rating} star`}
            className={rating <= value ? "selected" : ""}
          >
            <Star fill="currentColor" size={22} />
          </button>
        );
      })}
    </div>
  );
}

export function FeedbackSuccessPage() {
  const params = useParams<{ referenceNumber: string }>();
  return (
    <section className="card success-panel">
      <CheckCircle2 size={44} />
      <span className="eyebrow">Submitted</span>
      <h1>{params.referenceNumber}</h1>
      <p>Your feedback has been recorded.</p>
      <div className="button-row" style={{ justifyContent: "center" }}>
        <Link className="btn btn-primary" href="/feedback/scanner">
          <QrCode size={17} />
          Scan another
        </Link>
        <Link className="btn btn-secondary" href="/student/feedback/history">
          <History size={17} />
          History
        </Link>
      </div>
    </section>
  );
}

export function FeedbackHistoryPage() {
  const query = useQuery({
    queryKey: ["my-feedback-history"],
    queryFn: () =>
      api.get<PageResponse<FeedbackSubmission>>(
        "/feedback/my-history?pageSize=50",
      ),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Student feedback</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Submission history
          </h1>
          <p className="page-subtitle">
            Your own feedback references and ratings.
          </p>
        </div>
        <Link href="/feedback/scanner" className="btn btn-primary">
          <QrCode size={17} />
          Scan QR
        </Link>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !query.data?.data.length ? (
        <EmptyState />
      ) : (
        <FeedbackSubmissionTable rows={query.data.data} management={false} />
      )}
    </>
  );
}

export function FeedbackDashboardPage({
  endpoint = "/feedback/dashboard",
  title = "Feedback dashboard",
}: {
  endpoint?: string;
  title?: string;
}) {
  const query = useQuery({
    queryKey: ["feedback-dashboard", endpoint],
    queryFn: () => api.get<DashboardData>(endpoint),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return <ErrorState message="Feedback analytics could not be loaded." />;
  const { summary } = query.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Smart campus</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            Ratings, QR activity, open actions and sentiment across your
            authorized scope.
          </p>
        </div>
      </div>
      <section className="metric-grid">
        {metricCard("Submissions", summary.totalFeedbackSubmissions, FileText)}
        {metricCard(
          "Average rating",
          summary.averageCollegeRating || "-",
          Star,
          ratingColor(summary.averageCollegeRating),
        )}
        {metricCard("Active QR", summary.activeQrCodes, QrCode)}
        {metricCard(
          "Critical",
          summary.criticalComplaints,
          ShieldAlert,
          "#dc2626",
        )}
        {metricCard(
          "Pending actions",
          summary.pendingActions,
          AlertTriangle,
          "#d97706",
        )}
        {metricCard(
          "Resolved",
          summary.resolvedIssues,
          CheckCircle2,
          "#15803d",
        )}
      </section>
      <div className="chart-grid">
        <ChartCard title="Rating distribution">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={query.data.ratingDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="rating" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Department rating">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={query.data.departmentWise.slice(0, 8)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 5]} />
              <Tooltip />
              <Bar
                dataKey="averageRating"
                fill="#059669"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Sentiment">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={query.data.sentimentDistribution}
                dataKey="count"
                nameKey="name"
                innerRadius={55}
                outerRadius={100}
              >
                {query.data.sentimentDistribution.map((_entry, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Category performance">
          <CategoryList rows={query.data.categoryWise.slice(0, 12)} />
        </ChartCard>
      </div>
    </>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="card chart-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function CategoryList({
  rows,
}: {
  rows: Array<{ name: string; count: number; averageRating: number }>;
}) {
  return (
    <div>
      {rows.map((row) => (
        <div className="subject-row" key={row.name}>
          <span>
            <strong>{row.name}</strong>
            <small>{row.count} ratings</small>
          </span>
          <div>
            <span
              style={{
                width: `${(row.averageRating / 5) * 100}%`,
                background: ratingColor(row.averageRating),
              }}
            />
          </div>
          <strong>{row.averageRating}</strong>
        </div>
      ))}
    </div>
  );
}

export function StaffFeedbackPage({
  staffId = "me",
  title = "My feedback",
}: {
  staffId?: string;
  title?: string;
}) {
  const query = useQuery({
    queryKey: ["staff-feedback", staffId],
    queryFn: () =>
      api.get<StaffAnalytics>(`/feedback/staff/${staffId}/analytics`),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return <ErrorState message="Staff feedback could not be loaded." />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{query.data.staff.staffId}</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            {query.data.staff.name} - {query.data.staff.department ?? "College"}
          </p>
        </div>
        <div className="rating-pill">
          <Star size={18} fill="currentColor" />
          {query.data.overallAverageRating || "-"}
        </div>
      </div>
      <section className="metric-grid">
        {metricCard("Feedback count", query.data.totalFeedbackCount, FileText)}
        {metricCard(
          "Badge",
          query.data.ratingBadge,
          Star,
          ratingColor(query.data.overallAverageRating),
        )}
        {metricCard(
          "Positive",
          `${query.data.positiveFeedbackPercentage}%`,
          CheckCircle2,
          "#15803d",
        )}
        {metricCard(
          "Attendance",
          `${query.data.attendance.attendancePercentage}%`,
          ClipboardCheck,
        )}
      </section>
      <div className="feedback-form-grid">
        <ChartCard title="Category ratings">
          <CategoryList rows={query.data.categoryRatings} />
        </ChartCard>
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Comments</h2>
              <p>Visible comments follow administration settings.</p>
            </div>
          </div>
          {query.data.comments.length ? (
            query.data.comments.map((comment) => (
              <article
                className="feedback-comment"
                key={comment.referenceNumber}
              >
                <strong>{comment.referenceNumber}</strong>
                <small>
                  {new Date(comment.submittedAt).toLocaleString()} -{" "}
                  {comment.rating} stars
                </small>
                <p>
                  {[
                    comment.positiveComment,
                    comment.improvementComment,
                    comment.generalComment,
                    comment.complaintText,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                <StatusBadge value={comment.status} />
              </article>
            ))
          ) : (
            <div className="empty">No comments are visible.</div>
          )}
        </section>
      </div>
    </>
  );
}

export function StaffRatingsDirectoryPage({
  title,
  detailBasePath,
}: {
  title: string;
  detailBasePath: string;
}) {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["staff-rating-directory", detailBasePath, search],
    queryFn: () =>
      api.get<FeedbackTarget[]>(
        `/feedback/targets?targetType=STAFF&search=${encodeURIComponent(search.trim())}`,
      ),
  });
  const targets = query.data?.filter((target) => target.staff) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Feedback analytics</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            Open a staff member from your authorized scope to review ratings,
            attendance and permitted comments.
          </p>
        </div>
      </div>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, staff ID or department"
            />
          </label>
        </div>
      </section>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message="The scoped staff directory could not be loaded." />
      ) : !targets.length ? (
        <EmptyState
          title="No staff targets found"
          message="Try another search or ask an administrator to generate staff feedback targets."
        />
      ) : (
        <section className="staff-directory-grid">
          {targets.map((target) => (
            <Link
              className="card staff-directory-card"
              href={`${detailBasePath}/${encodeURIComponent(target.staff!.publicId)}`}
              key={target.id}
            >
              <FeedbackTargetAvatar target={target} compact />
              <span>
                <strong>{target.staff!.name}</strong>
                <small>{target.staff!.staffId}</small>
                <small>
                  {[target.staff!.designation, target.staff!.department?.name]
                    .filter(Boolean)
                    .join(" - ") || "College staff"}
                </small>
              </span>
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
          ))}
        </section>
      )}
    </>
  );
}

export function StaffFeedbackRoutePage({
  title = "Staff feedback",
}: {
  title?: string;
}) {
  const params = useParams<{ staffId: string }>();
  return <StaffFeedbackPage staffId={params.staffId} title={title} />;
}

export function QrManagementPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [preview, setPreview] = useState<{ row: QrRow; url: string } | null>(
    null,
  );
  const query = useQuery({
    queryKey: ["feedback-qr", search, status, page],
    queryFn: () =>
      api.get<PageResponse<QrRow>>(
        `/admin/feedback/qr?page=${page}&pageSize=25&search=${encodeURIComponent(search)}&status=${status}`,
      ),
  });
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview?.url],
  );
  function beginAction(key: string) {
    setBusyAction(key);
    setActionMessage("");
    setActionError("");
  }
  function failAction(caught: unknown, fallback: string) {
    setActionError(errorMessage(caught, fallback));
  }
  const bulk = useMutation({
    mutationFn: () =>
      api.post<{ targetsCreated: number; qrCreated: number }>(
        "/admin/feedback/qr/bulk-generate",
        {},
      ),
    onSuccess: (result) => {
      setActionMessage(
        `Created ${result.qrCreated} QR code${result.qrCreated === 1 ? "" : "s"}; ${result.targetsCreated} target${result.targetsCreated === 1 ? "" : "s"} added.`,
      );
      void client.invalidateQueries({ queryKey: ["feedback-qr"] });
    },
    onError: (caught) => failAction(caught, "QR codes could not be generated."),
  });
  const patchStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.patch(`/admin/feedback/qr/${id}/status`, { status: next }),
    onSuccess: (_result, variables) => {
      setActionMessage(
        `QR code status changed to ${variables.next.replaceAll("_", " ").toLowerCase()}.`,
      );
      void client.invalidateQueries({ queryKey: ["feedback-qr"] });
    },
    onError: (caught) =>
      failAction(caught, "The QR status could not be changed."),
  });
  const regenerate = useMutation({
    mutationFn: (id: string) => api.post(`/admin/feedback/qr/${id}/regenerate`),
    onSuccess: () => {
      setActionMessage("The secure QR token was regenerated.");
      void client.invalidateQueries({ queryKey: ["feedback-qr"] });
    },
    onError: (caught) =>
      failAction(caught, "The QR code could not be regenerated."),
  });
  async function copySecureUrl(row: QrRow) {
    beginAction(`${row.id}:copy`);
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(row.secureUrl);
      } else {
        const field = document.createElement("textarea");
        field.value = row.secureUrl;
        field.readOnly = true;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied)
          throw new Error("Clipboard access is unavailable in this browser.");
      }
      setActionMessage("Secure feedback URL copied.");
    } catch (caught) {
      failAction(
        caught,
        "The secure URL could not be copied. Check the browser clipboard permission.",
      );
    } finally {
      setBusyAction("");
    }
  }
  async function downloadQr(row: QrRow, format: "png" | "svg" | "pdf") {
    beginAction(`${row.id}:${format}`);
    try {
      const suffix = format === "pdf" ? "-poster.pdf" : `.${format}`;
      await api.download(
        `/admin/feedback/qr/${row.id}/download?format=${format}`,
        `${row.qrId}${suffix}`,
      );
      setActionMessage(
        `${format.toUpperCase()} download prepared for ${row.target.targetName}.`,
      );
    } catch (caught) {
      failAction(
        caught,
        `The ${format.toUpperCase()} file could not be generated.`,
      );
    } finally {
      setBusyAction("");
    }
  }
  async function previewPoster(row: QrRow) {
    beginAction(`${row.id}:preview`);
    try {
      const blob = await api.blob(
        `/admin/feedback/qr/${row.id}/download?format=poster`,
      );
      setPreview({ row, url: URL.createObjectURL(blob) });
      setActionMessage(`Poster preview ready for ${row.target.targetName}.`);
    } catch (caught) {
      failAction(caught, "The poster preview could not be generated.");
    } finally {
      setBusyAction("");
    }
  }
  function printPoster() {
    if (!preview) return;
    const popup = window.open(preview.url, "_blank");
    if (!popup) {
      setActionError("Allow pop-ups for this site, then select Print again.");
      return;
    }
    popup.opener = null;
    const print = () => {
      popup.focus();
      popup.print();
    };
    if (popup.document.readyState === "complete") window.setTimeout(print, 100);
    else popup.addEventListener("load", print, { once: true });
  }
  function changeStatus(row: QrRow, next: string) {
    if (
      next === "ARCHIVED" &&
      !window.confirm(`Archive the QR code for ${row.target.targetName}?`)
    )
      return;
    setActionMessage("");
    setActionError("");
    patchStatus.mutate({ id: row.id, next });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            QR code management
          </h1>
          <p className="page-subtitle">
            Generate, preview, download, print and control official feedback QR
            codes.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setActionMessage("");
            setActionError("");
            bulk.mutate();
          }}
          disabled={bulk.isPending}
        >
          <RefreshCw size={17} />
          {bulk.isPending ? "Generating..." : "Bulk generate"}
        </button>
      </div>
      {actionMessage && (
        <div className="success-box" role="status">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="error-box" role="alert">
          {actionError}
        </div>
      )}
      <section className="card" style={{ margin: "18px 0" }}>
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search target"
            />
          </label>
          <label className="select-field">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All status</option>
              {["ACTIVE", "DISABLED", "EXPIRED", "ARCHIVED"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !query.data?.data.length ? (
        <EmptyState />
      ) : (
        <>
          <div className="card table-wrap qr-management-table">
            <table>
              <thead>
                <tr>
                  <th>QR record</th>
                  <th>Target</th>
                  <th>Context</th>
                  <th>Lifecycle</th>
                  <th>Activity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.qrId.slice(0, 8)}</strong>
                      <small className="muted" style={{ display: "block" }}>
                        Created {new Date(row.createdAt).toLocaleDateString()}
                      </small>
                      <small className="muted" style={{ display: "block" }}>
                        By {row.createdBy ?? "System"}
                      </small>
                    </td>
                    <td>
                      <strong>{row.target.targetName}</strong>
                      <small className="muted" style={{ display: "block" }}>
                        {row.target.targetType.replaceAll("_", " ")}
                      </small>
                      {row.target.staff && (
                        <small className="muted" style={{ display: "block" }}>
                          {row.target.staff.staffId}
                        </small>
                      )}
                    </td>
                    <td>
                      {row.target.department?.name ??
                        row.target.campus?.name ??
                        "College"}
                      <small className="muted" style={{ display: "block" }}>
                        {[
                          row.target.block?.name,
                          row.target.floor?.name,
                          row.target.room?.roomNumber,
                        ]
                          .filter(Boolean)
                          .join(" - ") || "No location detail"}
                      </small>
                    </td>
                    <td>
                      <span>
                        {row.expiryDate
                          ? `Expires ${new Date(row.expiryDate).toLocaleDateString()}`
                          : "No expiry"}
                      </span>
                      <small className="muted" style={{ display: "block" }}>
                        {row.lastScannedAt
                          ? `Last scan ${new Date(row.lastScannedAt).toLocaleString()}`
                          : "Never scanned"}
                      </small>
                    </td>
                    <td>
                      <strong>{row.scanCount}</strong> scans
                      <small className="muted" style={{ display: "block" }}>
                        {row.feedbackCount} feedback submissions
                      </small>
                    </td>
                    <td>
                      <StatusBadge value={row.status} />
                    </td>
                    <td>
                      <div className="button-row qr-actions">
                        <button
                          className="btn btn-secondary"
                          disabled={busyAction === `${row.id}:copy`}
                          onClick={() => void copySecureUrl(row)}
                        >
                          <Copy size={15} />
                          Copy
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={busyAction === `${row.id}:preview`}
                          onClick={() => void previewPoster(row)}
                        >
                          <Eye size={15} />
                          Preview
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={busyAction === `${row.id}:png`}
                          onClick={() => void downloadQr(row, "png")}
                        >
                          <Download size={15} />
                          PNG
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={busyAction === `${row.id}:svg`}
                          onClick={() => void downloadQr(row, "svg")}
                        >
                          <Download size={15} />
                          SVG
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={busyAction === `${row.id}:pdf`}
                          onClick={() => void downloadQr(row, "pdf")}
                        >
                          <FileText size={15} />
                          PDF
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={regenerate.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Regenerate the secure token for ${row.target.targetName}? Existing posters will stop working.`,
                              )
                            )
                              regenerate.mutate(row.id);
                          }}
                        >
                          <RefreshCw size={15} />
                          Regenerate
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={patchStatus.isPending}
                          onClick={() =>
                            changeStatus(
                              row,
                              row.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                            )
                          }
                        >
                          {row.status === "ACTIVE" ? (
                            <ToggleLeft size={15} />
                          ) : (
                            <ToggleRight size={15} />
                          )}
                          {row.status === "ACTIVE" ? "Disable" : "Activate"}
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={
                            patchStatus.isPending || row.status === "ARCHIVED"
                          }
                          onClick={() => changeStatus(row, "ARCHIVED")}
                        >
                          <Archive size={15} />
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.meta.pageCount > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <span>
                Page {query.data.meta.page} of {query.data.meta.pageCount}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page >= query.data.meta.pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
      {preview && (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPreview(null);
          }}
        >
          <section
            className="card qr-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-preview-title"
          >
            <header>
              <div>
                <span className="eyebrow">Official poster</span>
                <h2 id="qr-preview-title">{preview.row.target.targetName}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close poster preview"
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="qr-preview-canvas">
              <Image
                src={preview.url}
                alt={`QR poster for ${preview.row.target.targetName}`}
                width={720}
                height={1018}
                unoptimized
              />
            </div>
            <footer>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={printPoster}
              >
                <Printer size={17} />
                Print poster
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

export function FeedbackSubmissionsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const query = useQuery({
    queryKey: ["feedback-submissions", status],
    queryFn: () =>
      api.get<PageResponse<FeedbackSubmission>>(
        `/admin/feedback/submissions?pageSize=50&status=${status}`,
      ),
  });
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.patch(`/admin/feedback/submissions/${id}/status`, { status: next }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["feedback-submissions"] }),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Management</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Feedback submissions
          </h1>
          <p className="page-subtitle">
            Review, assign and resolve feedback records in your authorized
            scope.
          </p>
        </div>
        <select
          className="input"
          style={{ width: 190 }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All status</option>
          {[
            "NEW",
            "VIEWED",
            "UNDER_REVIEW",
            "ASSIGNED",
            "ACTION_REQUIRED",
            "RESOLVED",
            "REJECTED",
            "ARCHIVED",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !query.data?.data.length ? (
        <EmptyState />
      ) : (
        <FeedbackSubmissionTable
          rows={query.data.data}
          management
          onStatus={(id, next) => update.mutate({ id, next })}
        />
      )}
    </>
  );
}

function FeedbackSubmissionTable({
  rows,
  management,
  onStatus,
}: {
  rows: FeedbackSubmission[];
  management: boolean;
  onStatus?: (id: string, status: string) => void;
}) {
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Target</th>
            <th>Rating</th>
            {management && <th>Student</th>}
            <th>Status</th>
            <th>Priority</th>
            <th>Comment</th>
            {management && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? row.referenceNumber}>
              <td>
                <strong>{row.referenceNumber}</strong>
                <small className="muted" style={{ display: "block" }}>
                  {new Date(row.submittedAt).toLocaleString()}
                </small>
              </td>
              <td>
                <strong>{row.target.targetName}</strong>
                <small className="muted" style={{ display: "block" }}>
                  {row.target.targetType.replaceAll("_", " ")}
                </small>
              </td>
              <td>
                <span className="rating-pill small">
                  <Star size={14} fill="currentColor" />
                  {row.overallRating}
                </span>
              </td>
              {management && <td>{row.student?.fullName ?? "Protected"}</td>}
              <td>
                <StatusBadge value={row.status} />
              </td>
              <td>
                <StatusBadge value={row.priority} />
              </td>
              <td>
                {row.comments.complaint ??
                  row.comments.improvement ??
                  row.comments.general ??
                  row.comments.positive ??
                  "No comment"}
              </td>
              {management && (
                <td>
                  <div className="button-row">
                    <button
                      className="btn btn-secondary"
                      onClick={() => onStatus?.(row.id, "VIEWED")}
                    >
                      View
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onStatus?.(row.id, "UNDER_REVIEW")}
                    >
                      Review
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onStatus?.(row.id, "RESOLVED")}
                    >
                      Resolve
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttendanceAnalyticsPage({
  title = "Attendance analytics",
}: {
  title?: string;
}) {
  const staff = useQuery({
    queryKey: ["attendance-staff-summary"],
    queryFn: () =>
      api.get<{
        data: Array<{
          staff: {
            fullName: string;
            collegeIdentityId: string;
            staffProfile: {
              employeeId: string;
              designation: string | null;
              department: SelectOption | null;
            } | null;
          };
          attendancePercentage: number;
          totalWorkingDays: number;
          submittedSessions: number;
          totalSessions: number;
        }>;
      }>("/attendance/staff-summary"),
  });
  const classes = useQuery({
    queryKey: ["attendance-class-summary"],
    queryFn: () =>
      api.get<
        Array<{
          section: {
            name: string;
            code: string;
            semester: { programme: { department: { name: string } } };
          };
          total: number;
          attended: number;
          absent: number;
          onDuty: number;
          leave: number;
          attendancePercentage: number;
          status: string;
        }>
      >("/attendance/class-summary"),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Attendance</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            Backend-calculated staff and class attendance percentages.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            void api.download(
              "/reports/attendance/export.csv",
              "attendance.csv",
            )
          }
        >
          <Download size={17} />
          Export CSV
        </button>
      </div>
      <div className="feedback-form-grid">
        <section>
          {staff.isLoading ? (
            <LoadingState />
          ) : staff.isError ? (
            <ErrorState />
          ) : (
            <div className="card table-wrap">
              <div className="section-head">
                <div>
                  <h2>Staff attendance</h2>
                  <p>Teaching session based summary</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Department</th>
                    <th>Sessions</th>
                    <th>Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.data?.data.map((row) => (
                    <tr key={row.staff.collegeIdentityId}>
                      <td>
                        <strong>{row.staff.fullName}</strong>
                        <small className="muted" style={{ display: "block" }}>
                          {row.staff.staffProfile?.employeeId ??
                            row.staff.collegeIdentityId}
                        </small>
                      </td>
                      <td>
                        {row.staff.staffProfile?.department?.name ?? "College"}
                      </td>
                      <td>
                        {row.submittedSessions}/{row.totalSessions}
                      </td>
                      <td>
                        <span className="rating-pill small">
                          {row.attendancePercentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section>
          {classes.isLoading ? (
            <LoadingState />
          ) : classes.isError ? (
            <ErrorState />
          ) : (
            <div className="card table-wrap">
              <div className="section-head">
                <div>
                  <h2>Class attendance</h2>
                  <p>Submitted and locked sessions</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Department</th>
                    <th>Periods</th>
                    <th>Absent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.data?.map((row) => (
                    <tr key={row.section.code + row.section.name}>
                      <td>
                        <strong>{row.section.name}</strong>
                        <small className="muted" style={{ display: "block" }}>
                          {row.section.code}
                        </small>
                      </td>
                      <td>{row.section.semester.programme.department.name}</td>
                      <td>
                        {row.attended}/{row.total} - {row.attendancePercentage}%
                      </td>
                      <td>{row.absent}</td>
                      <td>
                        <StatusBadge value={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function LowAttendancePage({
  title = "Low Attendance Students",
}: {
  title?: string;
}) {
  const [below, setBelow] = useState("75");
  const query = useQuery({
    queryKey: ["low-attendance", below],
    queryFn: () =>
      api.get<LowAttendanceRow[]>(`/attendance/low-attendance?below=${below}`),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Attendance</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            Students below the selected attendance threshold.
          </p>
        </div>
        <div className="button-row">
          <select
            className="input"
            style={{ width: 170 }}
            value={below}
            onChange={(event) => setBelow(event.target.value)}
          >
            <option value="75">Below 75%</option>
            <option value="65">Below 65%</option>
            <option value="50">Below 50%</option>
          </select>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void api.download(
                "/reports/attendance/export.csv",
                "low-attendance.csv",
              )
            }
          >
            <Download size={17} />
            Export
          </button>
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !query.data?.length ? (
        <EmptyState />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Attendance</th>
                <th>Needed</th>
                <th>Shortage</th>
                <th>Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.student.publicId}>
                  <td>
                    <strong>{row.student.name}</strong>
                    <small className="muted" style={{ display: "block" }}>
                      {row.student.registerNumber}
                    </small>
                  </td>
                  <td>
                    {row.class} {row.section}
                  </td>
                  <td>
                    {row.presentPeriods}/{row.totalPeriods} -{" "}
                    <strong>{row.attendancePercentage}%</strong>
                  </td>
                  <td>{row.classesNeededToReachRequiredPercentage}</td>
                  <td>
                    {row.subjectWiseShortage.slice(0, 2).map((subject) => (
                      <small
                        key={subject.subject.code}
                        style={{ display: "block" }}
                      >
                        {subject.subject.code}: {subject.shortageClasses}
                      </small>
                    ))}
                  </td>
                  <td>{row.mobileNumber ?? "Protected"}</td>
                  <td>
                    <StatusBadge value={row.attendanceStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ManagementInsightsPage() {
  const feedback = useQuery({
    queryKey: ["insights-feedback"],
    queryFn: () => api.get<DashboardData>("/feedback/dashboard"),
  });
  const low = useQuery({
    queryKey: ["insights-low"],
    queryFn: () =>
      api.get<LowAttendanceRow[]>("/attendance/low-attendance?below=75"),
  });
  if (feedback.isLoading || low.isLoading) return <LoadingState />;
  if (feedback.isError || low.isError || !feedback.data || !low.data)
    return <ErrorState />;
  const indicators = [
    {
      label: "Low satisfaction departments",
      value: feedback.data.departmentWise.filter((row) => row.averageRating < 3)
        .length,
      tone: "#dc2626",
    },
    {
      label: "Low-attendance students",
      value: low.data.length,
      tone: "#d97706",
    },
    {
      label: "Critical feedback",
      value: feedback.data.summary.criticalComplaints,
      tone: "#dc2626",
    },
    {
      label: "High-performing targets",
      value: feedback.data.targetWise.filter((row) => row.averageRating >= 4.5)
        .length,
      tone: "#15803d",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Management</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Management insights
          </h1>
          <p className="page-subtitle">
            Analytical indicators combining feedback, attendance and open action
            signals.
          </p>
        </div>
      </div>
      <section className="metric-grid">
        {indicators.map((item) =>
          metricCard(item.label, item.value, BarChart2, item.tone),
        )}
      </section>
      <div className="chart-grid">
        <ChartCard title="Attention indicators">
          <CategoryList
            rows={feedback.data.targetWise
              .filter((row) => row.averageRating < 3.5)
              .slice(0, 12)}
          />
        </ChartCard>
        <ChartCard title="Low-attendance sample">
          <div>
            {low.data.slice(0, 12).map((row) => (
              <div className="subject-row" key={row.student.publicId}>
                <span>
                  <strong>{row.student.name}</strong>
                  <small>
                    {row.class} - {row.student.registerNumber}
                  </small>
                </span>
                <div>
                  <span
                    style={{
                      width: `${row.attendancePercentage}%`,
                      background: ratingColor(row.attendancePercentage / 20),
                    }}
                  />
                </div>
                <strong>{row.attendancePercentage}%</strong>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        These are analytical indicators and not automatic disciplinary
        decisions.
      </p>
    </>
  );
}

export function FeedbackSettingsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["feedback-settings"],
    queryFn: () => api.get<FeedbackSettingsData>("/admin/feedback/settings"),
  });
  const [draft, setDraft] = useState<Partial<FeedbackSettingsData>>({});
  const form = query.data ? { ...query.data, ...draft } : null;
  const save = useMutation({
    mutationFn: () => api.put("/admin/feedback/settings", form),
    onSuccess: () => {
      setDraft({});
      void client.invalidateQueries({ queryKey: ["feedback-settings"] });
    },
  });
  if (query.isLoading || !form) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Feedback settings
          </h1>
          <p className="page-subtitle">
            Submission visibility and attendance threshold settings.
          </p>
        </div>
        <button className="btn btn-primary" disabled={save.isPending}>
          <Settings size={17} />
          {save.isPending ? "Saving..." : "Save settings"}
        </button>
      </div>
      <section className="card settings-grid">
        <label className="field">
          <span>Required attendance %</span>
          <input
            className="input"
            type="number"
            value={form.requiredAttendancePercentage}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                requiredAttendancePercentage: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          <span>Warning attendance %</span>
          <input
            className="input"
            type="number"
            value={form.attendanceWarningPercentage}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                attendanceWarningPercentage: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          <span>Critical attendance %</span>
          <input
            className="input"
            type="number"
            value={form.attendanceCriticalPercentage}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                attendanceCriticalPercentage: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="field">
          <span>Default submission limit</span>
          <select
            className="input"
            value={form.defaultSubmissionRule ?? "ONCE_PER_DAY"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                defaultSubmissionRule: event.target
                  .value as FeedbackSettingsData["defaultSubmissionRule"],
              }))
            }
          >
            <option value="ONCE_PER_DAY">Once per target per day</option>
            <option value="ONCE_PER_WEEK">Once per target per week</option>
            <option value="ONCE_PER_CYCLE">Once per feedback cycle</option>
            <option value="UNLIMITED">Unlimited submissions</option>
          </select>
        </label>
        {(
          [
            ["anonymousMode", "Allow anonymous submissions"],
            ["commentsRequired", "Require a written comment"],
            ["staffCanViewComments", "Let staff view permitted comments"],
            [
              "studentIdentityVisibleToManagement",
              "Show student identity to authorized management",
            ],
            [
              "negativeFeedbackRequiresInvestigation",
              "Require investigation for negative feedback",
            ],
            ["emailAlertsEnabled", "Send critical-feedback email alerts"],
            ["whatsAppAlertsEnabled", "Send critical-feedback WhatsApp alerts"],
          ] as const
        ).map(([key, label]) => (
          <label className="check-field settings-check" key={key}>
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [key]: event.target.checked,
                }))
              }
            />
            {label}
          </label>
        ))}
      </section>
    </form>
  );
}

export function FeedbackTargetsPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["feedback-targets-admin", search],
    queryFn: () =>
      api.get<FeedbackTarget[]>(
        `/feedback/targets?search=${encodeURIComponent(search)}`,
      ),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Feedback targets
          </h1>
          <p className="page-subtitle">
            Active faculty, location and service feedback targets.
          </p>
        </div>
        <Link href="/admin/feedback/qr-management" className="btn btn-primary">
          <QrCode size={17} />
          QR management
        </Link>
      </div>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search targets"
            />
          </label>
        </div>
      </section>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState />
      ) : !query.data?.length ? (
        <EmptyState />
      ) : (
        <div className="target-card-grid">
          {query.data.map((target) => (
            <article className="card target-card" key={target.id}>
              <span className="badge badge-blue">
                {target.targetType.replaceAll("_", " ")}
              </span>
              <h2>{target.targetName}</h2>
              <p>
                {[
                  target.staff?.staffId,
                  target.department?.name,
                  target.block?.name,
                  target.room?.roomNumber,
                  target.serviceCode,
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function FeedbackReportsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Feedback reports
          </h1>
          <p className="page-subtitle">
            Export feedback and attendance reports for authorized records.
          </p>
        </div>
      </div>
      <section className="target-card-grid">
        {[
          {
            title: "Feedback report",
            path: "/admin/feedback/reports/export.csv",
            name: "feedback-report.csv",
          },
          {
            title: "Attendance report",
            path: "/reports/attendance/export.csv",
            name: "attendance-report.csv",
          },
          {
            title: "Issue report",
            path: "/reports/issues/export.csv",
            name: "issue-report.csv",
          },
        ].map((report) => (
          <article className="card report-tile" key={report.path}>
            <FileText size={26} />
            <h2>{report.title}</h2>
            <button
              className="btn btn-primary"
              onClick={() => void api.download(report.path, report.name)}
            >
              <Download size={17} />
              Download CSV
            </button>
          </article>
        ))}
      </section>
    </>
  );
}

export function FeedbackConfigPage({ title }: { title: string }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {title}
          </h1>
          <p className="page-subtitle">
            Default configuration is seeded from the college database and
            enforced by the API.
          </p>
        </div>
        <Link className="btn btn-primary" href="/admin/feedback/settings">
          <Settings size={17} />
          Settings
        </Link>
      </div>
      <FeedbackSettingsPage />
    </>
  );
}
