"use client";

import { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CheckCircle2,
  FileImage,
  QrCode,
  Search,
  ShieldCheck,
  StopCircle,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

type CameraState =
  | "CHECKING_CAMERA"
  | "CAMERA_PERMISSION_REQUIRED"
  | "CAMERA_PERMISSION_DENIED"
  | "CAMERA_NOT_AVAILABLE"
  | "CAMERA_IN_USE"
  | "UNSUPPORTED_BROWSER"
  | "SCANNER_READY"
  | "SCANNING"
  | "QR_DETECTED"
  | "VALIDATING"
  | "INVALID_QR";

interface CameraOption {
  id: string;
  label: string;
}

interface QrValidationResult {
  valid: true;
  qrType: string;
  destination: string;
  label: string;
  context: Record<string, unknown>;
}

interface CameraGuidance {
  state: CameraState;
  title: string;
  message: string;
}

export default function ScanQrPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const htmlId = useId().replace(/:/g, "");
  const readerId = `avs-qr-reader-${htmlId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const decodeLockRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CameraState>("CAMERA_PERMISSION_REQUIRED");
  const [guidance, setGuidance] = useState<CameraGuidance>({
    state: "CAMERA_PERMISSION_REQUIRED",
    title: "Camera Permission Required",
    message:
      "AVS College Management needs camera access only to scan official QR codes and optionally capture issue photos.",
  });
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [detected, setDetected] = useState("");
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    return () => {
      decodeLockRef.current = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) {
        void scanner.stop().catch(() => undefined).finally(() => scanner.clear());
      } else {
        scanner?.clear();
      }
    };
  }, []);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;
    void handleDecoded(token, "MANUAL");
    // handleDecoded intentionally stays outside the dependency list because it
    // updates scanner state and should run only when the URL token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function start(requestedCameraId?: string) {
    if (cameraBusy) return;
    setCameraBusy(true);
    setError("");
    setDetected("");
    decodeLockRef.current = false;
    setState("CHECKING_CAMERA");
    setGuidance(cameraGuidance("CHECKING_CAMERA"));
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("Camera is not supported.", "NotSupportedError");
      if (!window.isSecureContext) throw new DOMException("Camera access requires HTTPS or localhost.", "SecurityError");
      const devices = cameras.length ? cameras : await Html5Qrcode.getCameras();
      const normalized = devices.map((camera) => ({ id: camera.id, label: camera.label }));
      setCameras(normalized);
      const selected =
        requestedCameraId ||
        cameraId ||
        normalized.find((camera) => /back|rear|environment/i.test(camera.label))?.id ||
        normalized[0]?.id;
      if (!selected) throw new DOMException("No camera was found.", "NotFoundError");
      const scanner = scannerRef.current ?? new Html5Qrcode(readerId, { verbose: false });
      scannerRef.current = scanner;
      if (scanner.isScanning) await scanner.stop();
      setState("SCANNER_READY");
      await scanner.start(
        selected,
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          void handleDecoded(decodedText, "CAMERA");
        },
        () => undefined,
      );
      setCameraId(selected);
      setRunning(true);
      setState("SCANNING");
      setGuidance({
        state: "SCANNING",
        title: "Scanning",
        message: "Point your camera at an official AVS QR code.",
      });
      try {
        const capabilities = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(capabilities.torch === true);
      } catch {
        setTorchSupported(false);
      }
    } catch (caught) {
      await stopScanner();
      const next = guidanceFromError(caught, window.isSecureContext);
      setState(next.state);
      setGuidance(next);
    } finally {
      setCameraBusy(false);
    }
  }

  async function stopScanner() {
    await scannerRef.current?.stop().catch(() => undefined);
    setRunning(false);
    setTorchSupported(false);
    setTorchOn(false);
  }

  async function closeScanner() {
    setCameraBusy(true);
    await stopScanner();
    decodeLockRef.current = false;
    setState("CAMERA_PERMISSION_REQUIRED");
    setGuidance(cameraGuidance("CAMERA_PERMISSION_REQUIRED"));
    setCameraBusy(false);
  }

  async function switchTo(nextCameraId: string) {
    setCameraId(nextCameraId);
    if (running) await start(nextCameraId);
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
    } catch {
      setError("The flashlight could not be changed on this camera.");
    }
  }

  async function handleDecoded(value: string, scanMethod: "CAMERA" | "IMAGE" | "MANUAL") {
    const trimmed = value.trim();
    if (!trimmed || decodeLockRef.current) return;
    const recent = lastScanRef.current;
    if (recent && recent.value === trimmed && Date.now() - recent.at < 2500) return;
    decodeLockRef.current = true;
    lastScanRef.current = { value: trimmed, at: Date.now() };
    setDetected(trimmed);
    setState("QR_DETECTED");
    setGuidance({
      state: "QR_DETECTED",
      title: "QR Detected",
      message: "Official AVS QR code detected. Validating location...",
    });
    await stopScanner();
    setState("VALIDATING");
    try {
      const result = await api.post<QrValidationResult>("/qr/validate", {
        token: trimmed,
        scanMethod,
      });
      setGuidance({
        state: "VALIDATING",
        title: "Location Identified",
        message: result.label,
      });
      router.push(result.destination);
    } catch (caught) {
      decodeLockRef.current = false;
      setState("INVALID_QR");
      setError(
        caught instanceof ApiError
          ? caught.message
          : "QR detected, but the server could not validate it. Check your connection and try again.",
      );
      setGuidance(cameraGuidance("INVALID_QR"));
    }
  }

  async function scanImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    setDetected("");
    try {
      const scanner = scannerRef.current ?? new Html5Qrcode(readerId, { verbose: false });
      scannerRef.current = scanner;
      if (scanner.isScanning) await scanner.stop();
      const decoded = await scanner.scanFile(file, false);
      await handleDecoded(decoded, "IMAGE");
    } catch {
      setState("INVALID_QR");
      setError("The QR image could not be read. Try another image.");
      setGuidance(cameraGuidance("INVALID_QR"));
    }
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!manual.trim()) return;
    void handleDecoded(manual, "MANUAL");
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">AVS QR scanner</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Scan QR
          </h1>
          <p className="page-subtitle">
            Scan official AVS QR codes for rooms, issue reporting and feedback.
          </p>
        </div>
      </div>
      <section className="feedback-scanner-grid">
        <div className="card scanner-panel">
          <div className="scanner-frame">
            <div id={readerId} />
            {!running && (
              <div className="scanner-idle">
                {state === "VALIDATING" ? <CheckCircle2 size={30} /> : <QrCode size={30} />}
                <strong>{displayState(state)}</strong>
                <span>{guidance.message}</span>
              </div>
            )}
          </div>
          <div className="camera-guidance" role={state === "INVALID_QR" ? "alert" : "status"}>
            <strong>{guidance.title}</strong>
            <p>{guidance.message}</p>
            {detected && <small className="muted">Detected code is held until backend validation completes.</small>}
          </div>
          {error && <div className="error-box">{error}</div>}
          <div className="button-row" style={{ justifyContent: "flex-start" }}>
            {!running ? (
              <button className="btn btn-primary" type="button" disabled={cameraBusy || state === "VALIDATING"} onClick={() => void start()}>
                <Camera size={18} />
                {cameraBusy ? "Checking camera..." : "Allow camera"}
              </button>
            ) : (
              <button className="btn btn-secondary" type="button" disabled={cameraBusy} onClick={() => void closeScanner()}>
                <StopCircle size={18} />
                Stop scanner
              </button>
            )}
            <button className="btn btn-secondary" type="button" onClick={() => fileInputRef.current?.click()}>
              <FileImage size={18} />
              Choose QR image
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => void scanImage(event)} />
            {running && torchSupported && (
              <button type="button" className="btn btn-secondary" aria-pressed={torchOn} onClick={() => void toggleTorch()}>
                {torchOn ? <ZapOff size={17} /> : <Zap size={17} />}
                {torchOn ? "Flashlight off" : "Flashlight on"}
              </button>
            )}
            {running && cameras.length > 1 && (
              <select className="input scanner-camera" aria-label="Switch camera" value={cameraId} onChange={(event) => void switchTo(event.target.value)}>
                {cameras.map((camera, index) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}
            {running && cameras.length > 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => {
                const index = cameras.findIndex((camera) => camera.id === cameraId);
                const next = cameras[(index + 1) % cameras.length];
                if (next) void switchTo(next.id);
              }}>
                <SwitchCamera size={17} />
                Switch camera
              </button>
            )}
            <button className="btn btn-secondary" type="button" onClick={() => router.back()}>
              <X size={18} />
              Cancel
            </button>
          </div>
        </div>
        <aside className="card scanner-side">
          <form className="manual-code-form" onSubmit={submitManual}>
            <div className="section-head">
              <div>
                <h2>Enter code manually</h2>
                <p>Use this when the camera cannot scan clearly.</p>
              </div>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              <label className="field">
                <span>QR token or official URL</span>
                <input className="input" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Paste an AVS QR URL or token" />
              </label>
              <button className="btn btn-primary" disabled={!manual.trim() || state === "VALIDATING"}>
                <Search size={17} />
                Validate code
              </button>
            </div>
          </form>
          <div className="target-search-panel">
            <div className="section-head">
              <div>
                <h2>Privacy</h2>
                <p>Scanner output is validated by the AVS server before navigation.</p>
              </div>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              <div className="camera-guidance">
                <ShieldCheck size={20} />
                <p>
                  The camera starts only after you tap Allow camera and is stopped after a QR is detected, when you stop scanning, or when you leave this page.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}

function displayState(state: CameraState): string {
  return state.replaceAll("_", " ").toLowerCase().replace(/^\w/, (value) => value.toUpperCase());
}

function cameraGuidance(state: CameraState): CameraGuidance {
  const messages: Record<CameraState, CameraGuidance> = {
    CHECKING_CAMERA: { state, title: "Checking Camera", message: "Checking camera support and available devices." },
    CAMERA_PERMISSION_REQUIRED: { state, title: "Camera Permission Required", message: "AVS College Management needs camera access only to scan official QR codes and optionally capture issue photos." },
    CAMERA_PERMISSION_DENIED: { state, title: "Camera Permission Denied", message: "Open your browser settings, allow camera access for this application and try again." },
    CAMERA_NOT_AVAILABLE: { state, title: "Camera Not Available", message: "No camera was found on this device. Choose a QR image or enter the code manually." },
    CAMERA_IN_USE: { state, title: "Camera In Use by Another App", message: "Close other apps or browser tabs using the camera and try again." },
    UNSUPPORTED_BROWSER: { state, title: "Unsupported Browser", message: "This browser cannot open the camera scanner. Choose a QR image or enter the code manually." },
    SCANNER_READY: { state, title: "Scanner Ready", message: "Camera is ready. Point it at an official AVS QR code." },
    SCANNING: { state, title: "Scanning", message: "Point your camera at an AVS QR code." },
    QR_DETECTED: { state, title: "QR Detected", message: "Official AVS QR code detected. Validating location..." },
    VALIDATING: { state, title: "Validating", message: "The server is validating this QR code." },
    INVALID_QR: { state, title: "Invalid QR", message: "This QR code is not recognized by the AVS College Management System." },
  };
  return messages[state];
}

function guidanceFromError(error: unknown, secureContext: boolean): CameraGuidance {
  if (!secureContext)
    return {
      state: "UNSUPPORTED_BROWSER",
      title: "Unsupported Browser",
      message: "Camera access requires HTTPS in production or localhost during development.",
    };
  if (error instanceof DOMException) {
    if (["NotAllowedError", "PermissionDeniedError"].includes(error.name)) return cameraGuidance("CAMERA_PERMISSION_DENIED");
    if (["NotFoundError", "DevicesNotFoundError"].includes(error.name)) return cameraGuidance("CAMERA_NOT_AVAILABLE");
    if (["NotReadableError", "TrackStartError"].includes(error.name)) return cameraGuidance("CAMERA_IN_USE");
    if (["NotSupportedError", "SecurityError"].includes(error.name)) return cameraGuidance("UNSUPPORTED_BROWSER");
  }
  return {
    state: "CAMERA_NOT_AVAILABLE",
    title: "Camera Not Available",
    message: "The camera could not be started. Choose a QR image or enter the code manually.",
  };
}
