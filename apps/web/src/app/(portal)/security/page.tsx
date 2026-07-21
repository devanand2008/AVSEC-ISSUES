"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Globe,
  Laptop,
  Loader2,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

function parseUserAgent(ua: string | null): { device: string; browser: string; os: string; isMobile: boolean } {
  if (!ua) return { device: "Unknown Device", browser: "Unknown Browser", os: "Unknown OS", isMobile: false };
  const lower = ua.toLowerCase();

  let os = "Unknown OS";
  if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("macintosh") || lower.includes("mac os")) os = "macOS";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) os = "iOS";
  else if (lower.includes("linux")) os = "Linux";

  let browser = "Web Browser";
  if (lower.includes("edg/")) browser = "Microsoft Edge";
  else if (lower.includes("chrome") && !lower.includes("edg")) browser = "Google Chrome";
  else if (lower.includes("firefox")) browser = "Mozilla Firefox";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Apple Safari";

  const isMobile = lower.includes("mobile") || lower.includes("android") || lower.includes("iphone");
  const isTablet = lower.includes("ipad") || lower.includes("tablet");
  const device = isTablet ? "Tablet" : isMobile ? "Mobile Phone" : "Desktop Computer";

  return { device, browser, os, isMobile };
}

export default function SecurityPage() {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/auth/sessions/${id}/revoke`),
    onMutate: async (id) => {
      setError("");
      setSuccessMsg("");
      await client.cancelQueries({ queryKey: ["sessions"] });
      const previous = client.getQueryData<Session[]>(["sessions"]);
      client.setQueryData<Session[]>(["sessions"], (current) =>
        current?.filter((session) => session.id !== id),
      );
      return { previous };
    },
    onError: (caught, _id, context) => {
      if (context?.previous) client.setQueryData(["sessions"], context.previous);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That session could not be signed out. Please try again.",
      );
    },
    onSuccess: () => setSuccessMsg("Device signed out successfully."),
    onSettled: () => client.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>("/auth/sessions/revoke-others"),
    onMutate: () => { setError(""); setSuccessMsg(""); },
    onSuccess: (data) => {
      setSuccessMsg(`Successfully signed out of ${data.revoked} other device${data.revoked === 1 ? "" : "s"}.`);
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : "Failed to sign out other devices.");
    },
  });

  const otherSessionsCount = (sessions.data?.filter((s) => !s.current).length ?? 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Account protection</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>Security & sessions</h1>
          <p className="page-subtitle">Review active sessions across your devices and control account security.</p>
        </div>
        <div className="heading-actions" style={{ display: "flex", gap: 10 }}>
          <Link className="btn btn-secondary" href="/change-password">
            <LockKeyhole size={16} />
            Change password
          </Link>
          {otherSessionsCount > 0 && (
            <button
              className="btn btn-primary"
              style={{ background: "#dc2626", borderColor: "#b91c1c" }}
              disabled={revokeOthers.isPending}
              onClick={() => {
                if (window.confirm(`Are you sure you want to sign out of ${otherSessionsCount} other active device(s)?`)) {
                  revokeOthers.mutate();
                }
              }}
              id="revoke-others-btn"
            >
              {revokeOthers.isPending ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />}
              Sign out other devices ({otherSessionsCount})
            </button>
          )}
        </div>
      </div>

      <section className="card security-banner" style={{ display: "flex", gap: 16, alignItems: "center", padding: "18px 22px", background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)", border: "1px solid #bfdbfe", borderRadius: 14 }}>
        <div style={{ background: "#2563eb", color: "#fff", padding: 12, borderRadius: 12, display: "flex" }}>
          <ShieldCheck size={26} />
        </div>
        <div>
          <strong style={{ fontSize: 16, color: "#1e3a8a", display: "block", marginBottom: 4 }}>Your session uses rotating secure refresh tokens</strong>
          <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
            For maximum security, access tokens expire frequently and rotate dynamically. Changing your password will automatically terminate and revoke every active session across all devices.
          </p>
        </div>
      </section>

      <div style={{ marginTop: 22 }}>
        {error && (
          <div className="error-box" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={18} /> {error}
          </div>
        )}
        {successMsg && (
          <div style={{ padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <CheckCircle2 size={18} /> {successMsg}
          </div>
        )}

        {sessions.isLoading ? (
          <LoadingState />
        ) : sessions.isError ? (
          <ErrorState />
        ) : (
          <section className="card">
            <div className="section-head" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 16, marginBottom: 12 }}>
              <div>
                <h2>Active sessions</h2>
                <p>{sessions.data?.length ?? 0} device(s) currently signed in to this account</p>
              </div>
            </div>

            <div className="session-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sessions.data?.map((session) => {
                const info = parseUserAgent(session.userAgent);
                return (
                  <article
                    key={session.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "16px 18px",
                      borderRadius: 12,
                      background: session.current ? "#f0fdf4" : "#f8fafc",
                      border: session.current ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: session.current ? "#16a34a" : "#64748b",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {info.isMobile ? <Smartphone size={22} /> : <Laptop size={22} />}
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <strong style={{ fontSize: 15, color: "#0f172a" }}>
                            {info.browser} on {info.os}
                          </strong>
                          {session.current ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: "#16a34a", color: "#fff", borderRadius: 99 }}>
                              This Device
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", background: "#e2e8f0", color: "#475569", borderRadius: 99 }}>
                              Active
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 14, fontSize: 13, color: "#64748b", flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Globe size={13} /> {session.ipAddress || "Unknown IP"}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Activity size={13} /> Last active: {new Date(session.lastSeenAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Calendar size={13} /> Signed in: {new Date(session.createdAt).toLocaleDateString("en-IN")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {!session.current && (
                        <button
                          className="btn btn-secondary"
                          style={{ color: "#dc2626", borderColor: "#fecaca", background: "#fff" }}
                          disabled={revoke.isPending}
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Sign out device (${info.browser} on ${info.os})?`)) {
                              revoke.mutate(session.id);
                            }
                          }}
                          id={`revoke-session-${session.id}`}
                        >
                          {revoke.isPending ? <Loader2 size={14} className="spin" /> : <LogOut size={14} />}
                          Sign out
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
