"use client";

import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

export interface QrValidationViewModel {
  state: "idle" | "detected" | "validating" | "valid" | "invalid";
  label?: string;
  message?: string;
}

export function QrValidationResult({ result }: { result: QrValidationViewModel }) {
  if (result.state === "idle") return null;
  const valid = result.state === "valid";
  const invalid = result.state === "invalid";
  const Icon = valid ? CheckCircle2 : invalid ? AlertTriangle : ShieldCheck;

  return (
    <div className={invalid ? "error-box" : "camera-guidance"} role={invalid ? "alert" : "status"}>
      <Icon size={20} />
      <div>
        <strong>{result.label ?? labelForState(result.state)}</strong>
        {result.message && <p>{result.message}</p>}
      </div>
    </div>
  );
}

function labelForState(state: QrValidationViewModel["state"]): string {
  const labels: Record<QrValidationViewModel["state"], string> = {
    idle: "",
    detected: "QR Detected",
    validating: "Validating",
    valid: "Location Identified",
    invalid: "Invalid QR",
  };
  return labels[state];
}
