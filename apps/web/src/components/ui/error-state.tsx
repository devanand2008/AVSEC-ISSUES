"use client";

import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}

/** Map common API errors to user-friendly messages */
function friendlyMessage(msg?: string): string {
  if (!msg) return "Something went wrong. Please try again.";
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("ERR_")) return "Network error. Check your internet connection.";
  if (msg.includes("401") || msg.includes("Unauthorized")) return "Your session has expired. Please log in again.";
  if (msg.includes("403") || msg.includes("Forbidden")) return "You don't have permission to perform this action.";
  if (msg.includes("404")) return "The requested resource was not found.";
  if (msg.includes("500") || msg.includes("Internal")) return "A server error occurred. Please try again later.";
  if (msg.includes("Prisma") || msg.includes("constraint")) return "A database error occurred. Please contact your administrator.";
  return msg;
}

export function ErrorState({ title = "Something went wrong", message, onRetry, retryLabel = "Try Again", icon }: ErrorStateProps) {
  const isNetwork = message?.includes("fetch") || message?.includes("network");

  return (
    <div className="avs-error-state">
      {icon ?? (isNetwork ? <WifiOff /> : <AlertCircle />)}
      <h3 className="avs-empty-state-title">{title}</h3>
      <p className="avs-empty-state-desc">{friendlyMessage(message)}</p>
      {onRetry && (
        <button className="avs-btn avs-btn-secondary" onClick={onRetry} type="button">
          <RefreshCw size={14} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
