"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  FileWarning,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Send,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError, idempotencyKey } from "@/lib/api";
import type { SelectOption } from "@/lib/types";

interface Category extends SelectOption {
  description?: string;
}
interface IssueType extends SelectOption {
  defaultPriority: string;
  isOther: boolean;
}
interface Draft {
  campusId: string;
  blockId: string;
  floorId: string;
  roomId: string;
  assetId: string;
  categoryId: string;
  issueTypeId: string;
  title: string;
  description: string;
  prioritySuggestion: string;
  exactPosition: string;
}
interface ProbableDuplicate {
  id: string;
  issueNumber: string;
  title: string;
  status: string;
  duplicateSubscriptionProof: string;
  duplicateSubscriptionProofExpiresAt: string;
}
interface QrValidationResult {
  valid: true;
  qrType: string;
  destination: string;
  label: string;
  context: Record<string, unknown>;
}
const initial: Draft = {
  campusId: "",
  blockId: "",
  floorId: "",
  roomId: "",
  assetId: "",
  categoryId: "",
  issueTypeId: "",
  title: "",
  description: "",
  prioritySuggestion: "MEDIUM",
  exactPosition: "",
};

export default function ReportIssuePage() {
  const router = useRouter();
  const submissionKey = useRef(idempotencyKey());
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");
  const [previewLarge, setPreviewLarge] = useState(false);
  const [roomToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("roomToken") ?? ""),
  );
  const [genericQrToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("qrToken") ?? ""),
  );
  const issueQrToken = roomToken || genericQrToken;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Draft>(() => {
    if (typeof window === "undefined") return initial;
    let draft = initial;
    const saved = localStorage.getItem("campusone_issue_draft");
    if (saved) {
      try {
        draft = { ...initial, ...(JSON.parse(saved) as Draft) };
      } catch {
        localStorage.removeItem("campusone_issue_draft");
      }
    }
    const params = new URLSearchParams(window.location.search);
    const location = {
      campusId: params.get("campusId") ?? "",
      blockId: params.get("blockId") ?? "",
      floorId: params.get("floorId") ?? "",
      roomId: params.get("roomId") ?? "",
    };
    return location.roomId ? { ...draft, ...location } : draft;
  });
  const [evidence, setEvidence] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState("");
  const [error, setError] = useState("");
  const [uploadWarning, setUploadWarning] = useState("");
  const [forceCreate, setForceCreate] = useState(false);
  const [duplicate, setDuplicate] = useState<ProbableDuplicate | null>(null);
  const [submitted, setSubmitted] = useState<{
    id: string;
    issueNumber: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    if (!submitted)
      localStorage.setItem("campusone_issue_draft", JSON.stringify(form));
  }, [form, submitted]);
  useEffect(() => {
    return () => revokeEvidencePreview(previewUrlRef);
  }, []);
  const campuses = useQuery({
    queryKey: ["campuses"],
    queryFn: () => api.get<SelectOption[]>("/locations/campuses"),
  });
  const qrRoom = useQuery({
    queryKey: ["room-qr", roomToken],
    queryFn: () =>
      api.get<{
        id: string;
        code: string;
        name: string;
        roomType: string;
        floor: {
          id: string;
          name: string;
          block: { id: string; name: string; campus: { id: string; name: string } };
        };
      }>(`/locations/rooms/qr/${roomToken}`),
    enabled: Boolean(roomToken),
  });
  const genericQr = useQuery({
    queryKey: ["issue-generic-qr", genericQrToken],
    queryFn: () =>
      api.post<QrValidationResult>("/qr/validate", {
        token: genericQrToken,
        scanMethod: "ROUTE",
      }),
    enabled: Boolean(genericQrToken && !roomToken),
    retry: false,
  });
  const genericLocation = useMemo(() => {
    const context = genericQr.data?.context ?? {};
    return {
      campusId: contextValue(context, "campusId"),
      blockId: contextValue(context, "blockId"),
      floorId: contextValue(context, "floorId"),
      roomId: contextValue(context, "roomId"),
    };
  }, [genericQr.data]);
  const qrLocation = qrRoom.data
    ? {
        campusId: qrRoom.data.floor.block.campus.id,
        blockId: qrRoom.data.floor.block.id,
        floorId: qrRoom.data.floor.id,
        roomId: qrRoom.data.id,
      }
    : genericLocation;
  const location = {
    campusId: qrLocation.campusId || form.campusId,
    blockId: qrLocation.blockId || form.blockId,
    floorId: qrLocation.floorId || form.floorId,
    roomId: qrLocation.roomId || form.roomId,
  };
  const qrContextLoading = Boolean(genericQrToken && !roomToken && genericQr.isPending);
  const lockCampus = Boolean(roomToken || qrContextLoading || genericLocation.campusId);
  const lockBlock = Boolean(roomToken || qrContextLoading || genericLocation.blockId);
  const lockFloor = Boolean(roomToken || qrContextLoading || genericLocation.floorId);
  const lockRoom = Boolean(roomToken || qrContextLoading || genericLocation.roomId);
  const blocks = useQuery({
    queryKey: ["blocks", location.campusId],
    queryFn: () =>
      api.get<SelectOption[]>(
        `/locations/blocks?campusId=${location.campusId}`,
      ),
    enabled: Boolean(location.campusId),
  });
  const floors = useQuery({
    queryKey: ["floors", location.blockId],
    queryFn: () =>
      api.get<SelectOption[]>(`/locations/floors?blockId=${location.blockId}`),
    enabled: Boolean(location.blockId),
  });
  const rooms = useQuery({
    queryKey: ["rooms", location.floorId],
    queryFn: () =>
      api.get<SelectOption[]>(`/locations/rooms?floorId=${location.floorId}`),
    enabled: Boolean(location.floorId),
  });
  const assets = useQuery({
    queryKey: ["assets", location.roomId],
    queryFn: () =>
      api.get<SelectOption[]>(`/locations/assets?roomId=${location.roomId}`),
    enabled: Boolean(location.roomId),
  });
  const categories = useQuery({
    queryKey: ["issue-categories"],
    queryFn: () => api.get<Category[]>("/issue-categories"),
  });
  const types = useQuery({
    queryKey: ["issue-types", form.categoryId],
    queryFn: () =>
      api.get<IssueType[]>(`/issue-types?categoryId=${form.categoryId}`),
    enabled: Boolean(form.categoryId),
  });
  const selection = useMemo(
    () => ({
      campus: campuses.data?.find((item) => item.id === location.campusId),
      block: blocks.data?.find((item) => item.id === location.blockId),
      floor: floors.data?.find((item) => item.id === location.floorId),
      room: rooms.data?.find((item) => item.id === location.roomId),
      asset: assets.data?.find((item) => item.id === form.assetId),
      category: categories.data?.find((item) => item.id === form.categoryId),
      issueType: types.data?.find((item) => item.id === form.issueTypeId),
    }),
    [
      location.campusId,
      location.blockId,
      location.floorId,
      location.roomId,
      form.assetId,
      form.categoryId,
      form.issueTypeId,
      campuses.data,
      blocks.data,
      floors.data,
      rooms.data,
      assets.data,
      categories.data,
      types.data,
    ],
  );
  const submit = useMutation({
    mutationFn: (force: boolean) =>
      api.post<{ id: string; issueNumber: string; status: string }>(
        "/issues",
        {
          roomId: location.roomId,
          ...(form.assetId ? { assetId: form.assetId } : {}),
          categoryId: form.categoryId,
          ...(form.issueTypeId ? { issueTypeId: form.issueTypeId } : {}),
          title: form.title,
          description: form.description,
          prioritySuggestion: form.prioritySuggestion,
          ...(issueQrToken ? { submissionSource: "QR_SCAN", qrToken: issueQrToken } : {}),
          ...(form.exactPosition ? { exactPosition: form.exactPosition } : {}),
          createDespiteDuplicate: force,
        },
        { "Idempotency-Key": submissionKey.current },
      ),
    onSuccess: async (result) => {
      submissionKey.current = idempotencyKey();
      localStorage.removeItem("campusone_issue_draft");
      setSubmitted(result);
      setDuplicate(null);
      if (evidence) {
        try {
          const purpose = "ISSUE_REPORT";
          const signed = await api.post<{
            storageKey: string;
            uploadUrl: string;
            requiredHeaders: Record<string, string>;
          }>(`/issues/${result.id}/attachments/presign`, {
            fileName: evidence.name,
            mimeType: evidence.type,
            sizeBytes: evidence.size,
            purpose,
          });
          await api.upload(signed.uploadUrl, evidence, signed.requiredHeaders);
          await api.post(`/issues/${result.id}/attachments/complete`, {
            fileName: evidence.name,
            mimeType: evidence.type,
            sizeBytes: evidence.size,
            purpose,
            storageKey: signed.storageKey,
          });
        } catch {
          setUploadWarning(
            "The issue was submitted, but its attachment could not be uploaded. You can add it from the issue page.",
          );
        }
      }
    },
    onError: (caught) => {
      if (
        caught instanceof ApiError &&
        caught.code === "PROBABLE_DUPLICATE" &&
        caught.details &&
        typeof caught.details === "object"
      ) {
        setDuplicate(caught.details as ProbableDuplicate);
        setError("");
      } else
        setError(
          caught instanceof ApiError
            ? caught.message
            : "The issue could not be submitted.",
        );
    },
  });
  const subscribe = useMutation({
    mutationFn: (match: ProbableDuplicate) =>
      api.post(`/issues/${match.id}/subscribe`, {
        duplicateSubscriptionProof: match.duplicateSubscriptionProof,
      }),
    onSuccess: (_result, match) => router.push(`/issues/${match.id}`),
    onError: (caught) => {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The existing issue could not be joined.",
      );
      if (caught instanceof ApiError && caught.status === 403)
        setDuplicate(null);
    },
  });
  function next(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === 1 && qrContextLoading)
      return setError("Validating the scanned QR location. Try again in a moment.");
    if (step === 1 && genericQrToken && genericQr.isError)
      return setError(
        genericQr.error instanceof ApiError
          ? genericQr.error.message
          : "The scanned QR code could not be validated.",
      );
    if (step === 1 && !location.roomId)
      return setError("Select the campus, block, floor and room.");
    if (step === 2 && !form.categoryId)
      return setError("Select an issue category.");
    if (step === 3 && !form.issueTypeId)
      return setError("Select the closest common problem.");
    if (
      step === 4 &&
      (form.title.trim().length < 3 || form.description.trim().length < 10)
    )
      return setError(
        "Add a short title and at least 10 characters of detail.",
      );
    setStep((value) => Math.min(5, value + 1));
  }
  async function chooseEvidence(next: File | null) {
    if (!next) {
      clearEvidence();
      return;
    }
    try {
      const checked = await prepareEvidence(next);
      revokeEvidencePreview(previewUrlRef);
      const previewUrl = URL.createObjectURL(checked);
      previewUrlRef.current = previewUrl;
      setError("");
      setEvidence(checked);
      setEvidencePreview(previewUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Choose a valid JPG, PNG or WebP image, or submit without a photo.",
      );
      clearEvidence();
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    }
  }
  function removeEvidence() {
    clearEvidence();
    if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function clearEvidence() {
    revokeEvidencePreview(previewUrlRef);
    setEvidence(null);
    setEvidencePreview("");
  }
  if (submitted)
    return (
      <section className="card success-panel">
        <span className="success-icon">
          <CheckCircle2 size={38} />
        </span>
        <span className="eyebrow">Issue submitted</span>
        <h1>{submitted.issueNumber}</h1>
        <p>
          Your report is safely recorded. Current status:{" "}
          <strong>{submitted.status.replaceAll("_", " ")}</strong>.
        </p>
        {uploadWarning && <div className="error-box">{uploadWarning}</div>}
        <div>
          <button
            className="btn btn-primary"
            onClick={() => router.push(`/issues/${submitted.id}`)}
          >
            Open issue
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setForm(initial);
              setEvidence(null);
              setStep(1);
              setSubmitted(null);
              setUploadWarning("");
            }}
          >
            Report another
          </button>
        </div>
      </section>
    );
  const labels = ["Location", "Category", "Problem", "Details", "Review"];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Campus services</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Report an issue
          </h1>
          <p className="page-subtitle">
            Tell us what is wrong and the right team will be notified.
          </p>
        </div>
        <Link href="/issues" className="btn btn-secondary">
          <ArrowLeft size={17} />
          My issues
        </Link>
      </div>
      {qrRoom.data && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <strong>Room identified from QR</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {qrRoom.data.floor.block.campus.name} / {qrRoom.data.floor.block.name} / {qrRoom.data.floor.name} / {qrRoom.data.name}
          </p>
        </div>
      )}
      {!roomToken && genericQrToken && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <strong>
            {genericQr.isPending
              ? "Validating QR location"
              : genericQr.data
                ? `${genericQr.data.qrType.replaceAll("_", " ")} QR identified`
                : "QR validation failed"}
          </strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {genericQr.data
              ? genericQr.data.label
              : genericQr.error instanceof ApiError
                ? genericQr.error.message
                : "Checking the scanned code before issue submission."}
          </p>
        </div>
      )}
      {duplicate && (
        <div className="card duplicate-panel">
          <FileWarning />
          <div>
            <strong>This may already be reported</strong>
            <p>
              <strong>
                {duplicate.issueNumber}: {duplicate.title}
              </strong>{" "}
              is currently {duplicate.status.replaceAll("_", " ").toLowerCase()}
              .
            </p>
          </div>
          <button
            className="btn btn-secondary"
            disabled={subscribe.isPending}
            onClick={() => subscribe.mutate(duplicate)}
          >
            {subscribe.isPending ? "Joining..." : "This is the same problem"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setForceCreate(true);
              setDuplicate(null);
              submit.mutate(true);
            }}
          >
            This is different
          </button>
        </div>
      )}
      <div className="wizard-layout">
        <aside className="card wizard-steps">
          {labels.map((label, index) => (
            <div
              className={
                step === index + 1
                  ? "current"
                  : step > index + 1
                    ? "complete"
                    : ""
              }
              key={label}
            >
              <span>{step > index + 1 ? <Check size={16} /> : index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>
                  {
                    [
                      "Where is it?",
                      "What kind?",
                      "Choose a match",
                      "Add context",
                      "Confirm & send",
                    ][index]
                  }
                </small>
              </div>
            </div>
          ))}
        </aside>
        <form className="card wizard-panel" onSubmit={next}>
          {error && <div className="error-box">{error}</div>}
          {step === 1 && (
            <section>
              <span className="step-icon">
                <MapPin />
              </span>
              <h2>Where is the problem?</h2>
              <p className="muted">
                Only active campus locations and assets are shown.
              </p>
              <div className="form-grid" style={{ marginTop: 22 }}>
                <SelectField
                  label="Campus"
                  value={location.campusId}
                  options={campuses.data}
                  disabled={lockCampus}
                  onChange={(campusId) =>
                    setForm({
                      ...form,
                      campusId,
                      blockId: "",
                      floorId: "",
                      roomId: "",
                      assetId: "",
                    })
                  }
                />
                <SelectField
                  label="Block"
                  value={location.blockId}
                  options={blocks.data}
                  disabled={lockBlock || !location.campusId}
                  onChange={(blockId) =>
                    setForm({
                      ...form,
                      blockId,
                      floorId: "",
                      roomId: "",
                      assetId: "",
                    })
                  }
                />
                <SelectField
                  label="Floor"
                  value={location.floorId}
                  options={floors.data}
                  disabled={lockFloor || !location.blockId}
                  onChange={(floorId) =>
                    setForm({ ...form, floorId, roomId: "", assetId: "" })
                  }
                />
                <SelectField
                  label="Room or area"
                  value={location.roomId}
                  options={rooms.data}
                  disabled={lockRoom || !location.floorId}
                  onChange={(roomId) =>
                    setForm({ ...form, roomId, assetId: "" })
                  }
                />
                <SelectField
                  label="Specific asset (optional)"
                  value={form.assetId}
                  options={assets.data}
                  disabled={!location.roomId}
                  onChange={(assetId) => setForm({ ...form, assetId })}
                />
              </div>
            </section>
          )}
          {step === 2 && (
            <section>
              <span className="step-icon">
                <Tag />
              </span>
              <h2>Choose a category</h2>
              <p className="muted">
                This helps route the issue to the responsible team.
              </p>
              <div className="choice-grid">
                {categories.data?.map((item) => (
                  <button
                    type="button"
                    className={form.categoryId === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() =>
                      setForm({ ...form, categoryId: item.id, issueTypeId: "" })
                    }
                  >
                    <FileWarning size={20} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.description ?? "Campus service issue"}
                      </small>
                    </span>
                    {form.categoryId === item.id && <CheckCircle2 size={18} />}
                  </button>
                ))}
              </div>
            </section>
          )}
          {step === 3 && (
            <section>
              <span className="step-icon">
                <WrenchIcon />
              </span>
              <h2>What is happening?</h2>
              <p className="muted">
                Select the closest common problem configured by your college.
              </p>
              <div className="choice-list">
                {types.data?.map((item) => (
                  <label
                    className={form.issueTypeId === item.id ? "selected" : ""}
                    key={item.id}
                  >
                    <input
                      type="radio"
                      name="issueType"
                      value={item.id}
                      checked={form.issueTypeId === item.id}
                      onChange={() =>
                        setForm({
                          ...form,
                          issueTypeId: item.id,
                          prioritySuggestion: item.defaultPriority,
                        })
                      }
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        Suggested priority: {item.defaultPriority.toLowerCase()}
                      </small>
                    </span>
                    <CheckCircle2 size={19} />
                  </label>
                ))}
              </div>
            </section>
          )}
          {step === 4 && (
            <section>
              <span className="step-icon">
                <Paperclip />
              </span>
              <h2>Add useful details</h2>
              <p className="muted">
                Clear details help the service team arrive prepared.
              </p>
              <div className="form-grid" style={{ marginTop: 22 }}>
                <div className="field form-span">
                  <label htmlFor="title">Short title</label>
                  <input
                    id="title"
                    className="input"
                    maxLength={160}
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="e.g. Ceiling fan making a loud noise"
                  />
                </div>
                <div className="field form-span">
                  <label htmlFor="description">Description</label>
                  <textarea
                    id="description"
                    className="input"
                    maxLength={5000}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Describe what you observed and when it started."
                  />
                </div>
                <div className="field">
                  <label htmlFor="priority">Suggested priority</label>
                  <select
                    id="priority"
                    className="input"
                    value={form.prioritySuggestion}
                    onChange={(e) =>
                      setForm({ ...form, prioritySuggestion: e.target.value })
                    }
                  >
                    {["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="position">
                    Exact position <span className="muted">(optional)</span>
                  </label>
                  <input
                    id="position"
                    className="input"
                    value={form.exactPosition}
                    onChange={(e) =>
                      setForm({ ...form, exactPosition: e.target.value })
                    }
                    placeholder="e.g. back-left corner"
                  />
                </div>
                <div className="field form-span">
                  <label>
                    Add Photo <span className="muted">(Optional)</span>
                  </label>
                  <small className="muted" style={{ marginBottom: 10, display: "block" }}>
                    The photo is optional. Upload starts only after the issue is created.
                  </small>

                  <input
                    ref={evidenceInputRef}
                    id="evidence"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      void chooseEvidence(event.currentTarget.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      void chooseEvidence(event.currentTarget.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />

                  {!evidence && (
                    <div className="photo-action-row">
                      <button
                        type="button"
                        className="btn btn-secondary photo-btn"
                        onClick={() => cameraInputRef.current?.click()}
                      >
                        <Camera size={17} />
                        Take photo
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary photo-btn"
                        onClick={() => evidenceInputRef.current?.click()}
                      >
                        <ImageIcon size={17} />
                        Choose from gallery
                      </button>
                    </div>
                  )}

                  {evidence && (
                    <div className="attachment-preview">
                      {evidencePreview && (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={evidencePreview}
                            alt="Selected photo preview"
                            style={{ cursor: "pointer", borderRadius: 8, maxHeight: previewLarge ? "70dvh" : 180, width: "100%", objectFit: "contain", background: "#f1f5f9", transition: "max-height 0.2s" }}
                            onClick={() => setPreviewLarge((v) => !v)}
                            title={previewLarge ? "Tap to shrink" : "Tap to enlarge"}
                          />
                          <small className="muted" style={{ marginTop: 4 }}>
                            {previewLarge ? "Tap image to shrink" : "Tap image to enlarge"}
                          </small>
                        </>
                      )}
                      <span>
                        <strong>{evidence.name}</strong>
                        <small>
                          {(evidence.size / 1024 / 1024).toFixed(2)} MB
                        </small>
                      </span>
                      <div className="photo-action-row">
                        <button
                          type="button"
                          className="btn btn-secondary photo-btn"
                          onClick={() => {
                            setPreviewLarge(false);
                            evidenceInputRef.current?.click();
                          }}
                        >
                          Replace photo
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary photo-btn"
                          onClick={() => { setPreviewLarge(false); removeEvidence(); }}
                          style={{ color: "var(--danger)" }}
                        >
                          Remove photo
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
          {step === 5 && (
            <section>
              <span className="step-icon">
                <Send />
              </span>
              <h2>Review your report</h2>
              <p className="muted">
                Nothing is submitted until you press the final button.
              </p>
              <dl className="review-list">
                <div>
                  <dt>Location</dt>
                  <dd>
                    {selection.campus?.name} / {selection.block?.name} /{" "}
                    {selection.floor?.name} / {selection.room?.name}
                  </dd>
                </div>
                <div>
                  <dt>Asset</dt>
                  <dd>{selection.asset?.name ?? "No specific asset"}</dd>
                </div>
                <div>
                  <dt>Issue</dt>
                  <dd>
                    {selection.category?.name} / {selection.issueType?.name}
                  </dd>
                </div>
                <div>
                  <dt>Title</dt>
                  <dd>{form.title}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>{form.description}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{form.prioritySuggestion}</dd>
                </div>
                <div>
                  <dt>Attachment</dt>
                  <dd>{evidence?.name ?? "None"}</dd>
                </div>
              </dl>
            </section>
          )}
          <footer className="wizard-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={step === 1}
              onClick={() => {
                setError("");
                setStep((value) => value - 1);
              }}
            >
              <ArrowLeft size={17} />
              Back
            </button>
            {step < 5 ? (
              <button className="btn btn-primary">
                Continue
                <ArrowRight size={17} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={submit.isPending}
                onClick={() => submit.mutate(forceCreate)}
              >
                <Send size={17} />
                {submit.isPending ? "Submitting..." : "Submit issue"}
              </button>
            )}
          </footer>
        </form>
      </div>
    </>
  );
}

function contextValue(context: Record<string, unknown>, key: string): string {
  const value = context[key];
  return typeof value === "string" ? value : "";
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options?: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select
        className="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function WrenchIcon() {
  return <Building2 />;
}

const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

async function sniffMimeType(file: File): Promise<string | null> {
  try {
    const buffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    for (const sig of MAGIC_BYTES) {
      const start = sig.offset ?? 0;
      const match = sig.bytes.every((byte, i) => bytes[start + i] === byte);
      if (match) return sig.mime;
    }
  } catch {
  }
  return null;
}

async function prepareEvidence(file: File): Promise<File> {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type))
    throw new Error(
      "The photo type is not supported. Choose a JPG, PNG or WebP image, or submit without a photo.",
    );
  if (/[\\/\<>:"|?*\u0000-\u001f]/.test(file.name))
    throw new Error(
      "Rename the photo without special symbols and try again, or submit without a photo.",
    );
  if (file.size > 10 * 1024 * 1024)
    throw new Error("The photo is larger than 10 MB. Choose a smaller image, or submit without a photo.");

  const sniffed = await sniffMimeType(file);
  if (sniffed !== null && !allowedTypes.includes(sniffed))
    throw new Error("The file does not appear to be a valid image. Choose a real photo, or submit without one.");

  const image = await loadImage(file);
  if (image.naturalWidth < 32 || image.naturalHeight < 32)
    throw new Error("The photo is too small. Choose a clearer photo, or submit without a photo.");
  if (
    file.size <= 3 * 1024 * 1024 &&
    Math.max(image.naturalWidth, image.naturalHeight) <= 2200
  )
    return file;
  return compressImage(file, image);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected image appears to be corrupted."));
    };
    image.src = url;
  });
}

function compressImage(file: File, image: HTMLImageElement): Promise<File> {
  const maxSide = 1800;
  const scale = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(file);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size >= file.size) return resolve(file);
        resolve(
          new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
        );
      },
      "image/jpeg",
      0.82,
    );
  });
}

function revokeEvidencePreview(previewUrlRef: { current: string }) {
  if (!previewUrlRef.current) return;
  URL.revokeObjectURL(previewUrlRef.current);
  previewUrlRef.current = "";
}
