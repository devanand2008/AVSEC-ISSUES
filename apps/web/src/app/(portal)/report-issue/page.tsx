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
  locationType: "" | "ROOM" | "AREA";
  roomId: string;
  areaId: string;
  customAreaName: string;
  assetMode: "NONE" | "REGISTERED" | "CUSTOM";
  assetId: string;
  customAssetName: string;
  categoryId: string;
  issueTypeId: string;
  title: string;
  description: string;
  prioritySuggestion: string;
  exactPosition: string;
}
interface AssetOption extends SelectOption {
  code: string;
  room?: { code: string; name: string } | null;
  area?: { code: string; name: string } | null;
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
  locationType: "",
  roomId: "",
  areaId: "",
  customAreaName: "",
  assetMode: "NONE",
  assetId: "",
  customAssetName: "",
  categoryId: "",
  issueTypeId: "",
  title: "",
  description: "",
  prioritySuggestion: "MEDIUM",
  exactPosition: "",
};

const WIZARD_STEPS = [
  "LOCATION",
  "ISSUE_DETAILS",
  "EVIDENCE",
  "REVIEW",
  "SUCCESS",
] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

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
  const [step, setStep] = useState<WizardStep>("LOCATION");
  const stepIndex = WIZARD_STEPS.indexOf(step);
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
    return location.roomId ? { ...draft, ...location, locationType: "ROOM" } : draft;
  });
  const [evidence, setEvidence] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    areaId: form.areaId,
    customAreaName: form.customAreaName,
  };
  const qrContextLoading = Boolean(genericQrToken && !roomToken && genericQr.isPending);
  const lockCampus = Boolean(roomToken || qrContextLoading || genericLocation.campusId);
  const lockBlock = Boolean(roomToken || qrContextLoading || genericLocation.blockId);
  const lockFloor = Boolean(roomToken || qrContextLoading || genericLocation.floorId);
  const lockRoom = Boolean(roomToken || qrContextLoading || genericLocation.roomId);
  const effectiveLocationType: Draft["locationType"] = lockRoom ? "ROOM" : form.locationType;
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
      api.get<SelectOption[]>(`/campus/blocks/${location.blockId}/floors`),
    enabled: Boolean(location.blockId),
  });
  const rooms = useQuery({
    queryKey: ["rooms", location.floorId],
    queryFn: () =>
      api.get<SelectOption[]>(`/campus/floors/${location.floorId}/rooms`),
    enabled: Boolean(location.floorId && (form.locationType === "ROOM" || lockRoom)),
  });
  const areas = useQuery({
    queryKey: ["areas", location.floorId],
    queryFn: () => api.get<SelectOption[]>(`/campus/floors/${location.floorId}/areas`),
    enabled: Boolean(location.floorId && form.locationType === "AREA"),
  });
  const registeredLocation = form.locationType === "ROOM" || lockRoom
    ? (location.roomId ? `roomId=${encodeURIComponent(location.roomId)}` : "")
    : (location.areaId ? `areaId=${encodeURIComponent(location.areaId)}` : "");
  const assets = useQuery({
    queryKey: ["assets", form.locationType, location.roomId, location.areaId],
    queryFn: () =>
      api.get<AssetOption[]>(`/locations/assets?${registeredLocation}`),
    enabled: Boolean(registeredLocation && form.assetMode === "REGISTERED"),
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
      area: areas.data?.find((item) => item.id === location.areaId),
      asset: assets.data?.find((item) => item.id === form.assetId),
      category: categories.data?.find((item) => item.id === form.categoryId),
      issueType: types.data?.find((item) => item.id === form.issueTypeId),
    }),
    [
      location.campusId,
      location.blockId,
      location.floorId,
      location.roomId,
      location.areaId,
      form.assetId,
      form.categoryId,
      form.issueTypeId,
      campuses.data,
      blocks.data,
      floors.data,
      rooms.data,
      areas.data,
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
          locationType: effectiveLocationType,
          floorId: location.floorId,
          ...(effectiveLocationType === "ROOM" ? { roomId: location.roomId } : {}),
          ...(effectiveLocationType === "AREA" && location.areaId ? { areaId: location.areaId } : {}),
          ...(effectiveLocationType === "AREA" && location.customAreaName.trim() ? { customAreaName: location.customAreaName.trim() } : {}),
          ...(form.assetMode === "REGISTERED" && form.assetId ? { assetId: form.assetId } : {}),
          ...(form.assetMode === "CUSTOM" && form.customAssetName.trim() ? { customAssetName: form.customAssetName.trim() } : {}),
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
      setStep("SUCCESS");
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
  function failField(field: string, message: string) {
    setFieldErrors({ [field]: message });
    setError("");
    window.setTimeout(() => {
      const target = document.getElementById(field);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus();
    }, 0);
  }
  function clearValidation() {
    setFieldErrors({});
    setError("");
  }
  function next(event: FormEvent) {
    event.preventDefault();
    clearValidation();
    if (step === "LOCATION" && qrContextLoading)
      return setError("Validating the scanned QR location. Try again in a moment.");
    if (step === "LOCATION" && genericQrToken && genericQr.isError)
      return setError(
        genericQr.error instanceof ApiError
          ? genericQr.error.message
          : "The scanned QR code could not be validated.",
      );
    if (step === "LOCATION" && !location.campusId) return failField("campusId", "Select a campus.");
    if (step === "LOCATION" && !location.blockId) return failField("blockId", "Select a block.");
    if (step === "LOCATION" && !location.floorId) return failField("floorId", "Select a floor.");
    if (step === "LOCATION" && (floors.isFetching || rooms.isFetching || areas.isFetching || assets.isFetching))
      return setError("Location options are still loading. Try again in a moment.");
    if (step === "LOCATION" && !lockRoom && !form.locationType) return failField("locationType", "Choose Room or Area.");
    if (step === "LOCATION" && effectiveLocationType === "ROOM" && !location.roomId)
      return failField("roomId", "Select a room.");
    if (step === "LOCATION" && effectiveLocationType === "AREA" && !location.areaId && !location.customAreaName.trim())
      return failField("areaId", "Select an area or enter a custom area name.");
    if (step === "LOCATION" && effectiveLocationType === "AREA" && location.areaId && location.customAreaName.trim())
      return failField("customAreaName", "Use either an existing area or a custom area, not both.");
    if (step === "LOCATION" && form.assetMode === "REGISTERED" && !form.assetId)
      return failField("assetId", "Select a registered asset or choose another asset option.");
    if (step === "LOCATION" && form.assetMode === "CUSTOM" && !form.customAssetName.trim())
      return failField("customAssetName", "Enter the specific asset name.");
    if (step === "ISSUE_DETAILS" && (categories.isFetching || types.isFetching))
      return setError("Issue options are still loading. Try again in a moment.");
    if (step === "ISSUE_DETAILS" && !form.categoryId)
      return failField("categoryId", "Select an issue category.");
    if (step === "ISSUE_DETAILS" && !form.issueTypeId)
      return failField("issueTypeId", "Select the closest common problem.");
    if (step === "ISSUE_DETAILS" && (form.title.trim().length < 3 || form.description.trim().length < 10))
      return failField(form.title.trim().length < 3 ? "title" : "description", form.title.trim().length < 3 ? "Enter a title with at least 3 characters." : "Enter at least 10 characters of detail.");
    if (step === "REVIEW") {
      if (!submit.isPending) submit.mutate(forceCreate);
      return;
    }
    setStep(WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, stepIndex + 1)]!);
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
              setStep("LOCATION");
              setSubmitted(null);
              setUploadWarning("");
            }}
          >
            Report another
          </button>
        </div>
      </section>
    );
  const labels = ["Location", "Issue details", "Evidence", "Review", "Success"];
  const stepLoading = step === "LOCATION"
    ? campuses.isFetching || blocks.isFetching || floors.isFetching || rooms.isFetching || areas.isFetching || assets.isFetching
    : step === "ISSUE_DETAILS" && (categories.isFetching || types.isFetching);
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
                stepIndex === index
                  ? "current"
                  : stepIndex > index
                    ? "complete"
                    : ""
              }
              key={label}
            >
              <span>{stepIndex > index ? <Check size={16} /> : index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>
                  {
                    [
                      "Where is it?",
                      "Describe the problem",
                      "Add an optional photo",
                      "Confirm & send",
                      "Safely recorded",
                    ][index]
                  }
                </small>
              </div>
            </div>
          ))}
        </aside>
        <form className="card wizard-panel" onSubmit={next}>
          {error && <div className="error-box">{error}</div>}
          {step === "LOCATION" && (
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
                  id="campusId"
                  label="Campus"
                  value={location.campusId}
                  options={campuses.data}
                  disabled={lockCampus}
                  loading={campuses.isPending}
                  error={fieldErrors.campusId}
                  loadError={campuses.isError ? "Campuses could not be loaded." : ""}
                  onRetry={() => void campuses.refetch()}
                  onChange={(campusId) =>
                    setForm((current) => ({
                      ...current,
                      campusId,
                      blockId: "",
                      floorId: "",
                      locationType: "",
                      roomId: "",
                      areaId: "",
                      customAreaName: "",
                      assetMode: "NONE",
                      assetId: "",
                      customAssetName: "",
                    }))
                  }
                />
                <SelectField
                  id="blockId"
                  label="Block"
                  value={location.blockId}
                  options={blocks.data}
                  disabled={lockBlock || !location.campusId}
                  loading={blocks.isPending}
                  error={fieldErrors.blockId}
                  loadError={blocks.isError ? "Blocks could not be loaded." : ""}
                  onRetry={() => void blocks.refetch()}
                  onChange={(blockId) =>
                    setForm((current) => ({
                      ...current,
                      blockId,
                      floorId: "",
                      locationType: "",
                      roomId: "",
                      areaId: "",
                      customAreaName: "",
                      assetMode: "NONE",
                      assetId: "",
                      customAssetName: "",
                    }))
                  }
                />
                <SelectField
                  id="floorId"
                  label="Floor"
                  value={location.floorId}
                  options={floors.data}
                  disabled={lockFloor || !location.blockId}
                  loading={floors.isPending}
                  error={fieldErrors.floorId}
                  loadError={floors.isError ? "Floors could not be loaded. Please retry." : ""}
                  onRetry={() => void floors.refetch()}
                  onChange={(floorId) =>
                    setForm((current) => ({ ...current, floorId, locationType: "", roomId: "", areaId: "", customAreaName: "", assetMode: "NONE", assetId: "", customAssetName: "" }))
                  }
                />
                <div className="field form-span" id="locationType" tabIndex={-1}>
                  <label>Location type</label>
                  <div className="choice-list" style={{ marginTop: 8 }}>
                    {(["ROOM", "AREA"] as const).map((value) => (
                      <label className={effectiveLocationType === value ? "selected" : ""} key={value}>
                        <input type="radio" name="locationType" value={value} disabled={lockRoom || !location.floorId} checked={effectiveLocationType === value} onChange={() => setForm((current) => ({ ...current, locationType: value, roomId: "", areaId: "", customAreaName: "", assetMode: "NONE", assetId: "", customAssetName: "" }))} />
                        <span><strong>{value === "ROOM" ? "Room" : "Area"}</strong><small>{value === "ROOM" ? "Classroom, lab, office or hall" : "Corridor, stairwell or another named space"}</small></span>
                        <CheckCircle2 size={19} />
                      </label>
                    ))}
                  </div>
                  {fieldErrors.locationType && <small className="error-text">{fieldErrors.locationType}</small>}
                </div>
                {effectiveLocationType === "ROOM" && (
                  <SelectField id="roomId" label="Room" value={location.roomId} options={rooms.data} disabled={lockRoom || !location.floorId} loading={rooms.isPending} error={fieldErrors.roomId} loadError={rooms.isError ? "Rooms could not be loaded. Please retry." : ""} onRetry={() => void rooms.refetch()} onChange={(roomId) => setForm((current) => ({ ...current, roomId, areaId: "", customAreaName: "", assetMode: "NONE", assetId: "", customAssetName: "" }))} />
                )}
                {effectiveLocationType === "AREA" && (
                  <>
                    <SelectField id="areaId" label="Existing area" value={location.areaId} options={areas.data} disabled={!location.floorId || Boolean(form.customAreaName)} loading={areas.isPending} error={fieldErrors.areaId} loadError={areas.isError ? "Areas could not be loaded. Please retry." : ""} onRetry={() => void areas.refetch()} onChange={(areaId) => setForm((current) => ({ ...current, areaId, customAreaName: "", assetMode: "NONE", assetId: "", customAssetName: "" }))} />
                    <div className="field">
                      <label htmlFor="customAreaName">Or custom area</label>
                      <input id="customAreaName" className="input" maxLength={150} disabled={Boolean(location.areaId)} value={form.customAreaName} onChange={(event) => setForm((current) => ({ ...current, customAreaName: event.target.value, areaId: "", assetMode: "NONE", assetId: "", customAssetName: "" }))} placeholder="e.g. East stairwell landing" />
                      {fieldErrors.customAreaName && <small className="error-text">{fieldErrors.customAreaName}</small>}
                      {!areas.isPending && !areas.isError && areas.data?.length === 0 && <small className="muted">No saved areas on this floor. Enter a custom area above.</small>}
                    </div>
                  </>
                )}
                <div className="field form-span" id="assetMode" tabIndex={-1}>
                  <label>Specific asset</label>
                  <select className="input" value={form.assetMode} disabled={!(location.roomId || location.areaId || location.customAreaName.trim())} onChange={(event) => setForm((current) => ({ ...current, assetMode: event.target.value as Draft["assetMode"], assetId: "", customAssetName: "" }))}>
                    <option value="NONE">No specific asset</option>
                    {!location.customAreaName.trim() && <option value="REGISTERED">Select a registered asset</option>}
                    <option value="CUSTOM">Enter a custom asset</option>
                  </select>
                </div>
                {form.assetMode === "REGISTERED" && (
                  <SelectField id="assetId" label="Registered asset" value={form.assetId} options={assets.data} disabled={!registeredLocation} loading={assets.isPending} error={fieldErrors.assetId} loadError={assets.isError ? "Assets could not be loaded. Please retry." : ""} onRetry={() => void assets.refetch()} emptyMessage="No registered assets at this location. Choose a custom asset instead." onChange={(assetId) => setForm((current) => ({ ...current, assetId }))} />
                )}
                {form.assetMode === "CUSTOM" && (
                  <div className="field form-span">
                    <label htmlFor="customAssetName">Custom asset name</label>
                    <input id="customAssetName" className="input" maxLength={150} value={form.customAssetName} onChange={(event) => setForm((current) => ({ ...current, customAssetName: event.target.value }))} placeholder="e.g. Blue water dispenser beside the stairs" />
                    {fieldErrors.customAssetName && <small className="error-text">{fieldErrors.customAssetName}</small>}
                  </div>
                )}
              </div>
            </section>
          )}
          {step === "ISSUE_DETAILS" && (
            <section>
              <span className="step-icon">
                <Tag />
              </span>
              <h2>Choose a category</h2>
              <p className="muted">
                This helps route the issue to the responsible team.
              </p>
              <div className="choice-grid" id="categoryId" tabIndex={-1}>
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
              {fieldErrors.categoryId && <small className="error-text">{fieldErrors.categoryId}</small>}
            </section>
          )}
          {step === "ISSUE_DETAILS" && (
            <section>
              <span className="step-icon">
                <WrenchIcon />
              </span>
              <h2>What is happening?</h2>
              <p className="muted">
                Select the closest common problem configured by your college.
              </p>
              <div className="choice-list" id="issueTypeId" tabIndex={-1}>
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
              {fieldErrors.issueTypeId && <small className="error-text">{fieldErrors.issueTypeId}</small>}
            </section>
          )}
          {(step === "ISSUE_DETAILS" || step === "EVIDENCE") && (
            <section>
              <span className="step-icon">
                <Paperclip />
              </span>
              <h2>{step === "ISSUE_DETAILS" ? "Add useful details" : "Add a photo"}</h2>
              <p className="muted">
                {step === "ISSUE_DETAILS" ? "Clear details help the service team arrive prepared." : "Evidence is optional and can help the team diagnose the issue."}
              </p>
              <div className="form-grid" style={{ marginTop: 22 }}>
                {step === "ISSUE_DETAILS" && <>
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
                  {fieldErrors.title && <small className="error-text">{fieldErrors.title}</small>}
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
                  {fieldErrors.description && <small className="error-text">{fieldErrors.description}</small>}
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
                </>}
                {step === "EVIDENCE" && (
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
                )}
              </div>
            </section>
          )}
          {step === "REVIEW" && (
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
                    {selection.floor?.name} / {selection.room?.name ?? selection.area?.name ?? form.customAreaName}
                  </dd>
                </div>
                <div>
                  <dt>Asset</dt>
                  <dd>{selection.asset ? `${selection.asset.code} · ${selection.asset.name}` : form.customAssetName || "No specific asset"}</dd>
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
              disabled={step === "LOCATION"}
              onClick={() => {
                setError("");
                setStep(WIZARD_STEPS[Math.max(0, stepIndex - 1)]!);
              }}
            >
              <ArrowLeft size={17} />
              Back
            </button>
            {step !== "REVIEW" ? (
              <button className="btn btn-primary" disabled={stepLoading || step === "SUCCESS"}>
                {stepLoading ? "Loading…" : "Continue"}
                <ArrowRight size={17} />
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={submit.isPending}>
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
  id,
  label,
  value,
  options,
  disabled,
  loading,
  error,
  loadError,
  emptyMessage,
  onRetry,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options?: SelectOption[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  loadError?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={disabled || loading}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? `Loading ${label.toLowerCase()}…` : `Select ${label.toLowerCase()}`}</option>
        {options?.map((item) => (
          <option key={item.id} value={item.id}>
            {selectOptionLabel(item)}
          </option>
        ))}
      </select>
      {error && <small className="error-text">{error}</small>}
      {loadError && <small className="error-text">{loadError} {onRetry && <button className="btn-link" type="button" onClick={onRetry}>Retry</button>}</small>}
      {!loading && !loadError && options?.length === 0 && <small className="muted">{emptyMessage ?? `No active ${label.toLowerCase()} options are available.`}</small>}
    </div>
  );
}

function selectOptionLabel(item: SelectOption): string {
  const enriched = item as SelectOption & { code?: string; room?: { name: string } | null; area?: { name: string } | null };
  const location = enriched.room?.name ?? enriched.area?.name;
  return `${enriched.code ? `${enriched.code} · ` : ""}${item.name}${location ? ` — ${location}` : ""}`;
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
