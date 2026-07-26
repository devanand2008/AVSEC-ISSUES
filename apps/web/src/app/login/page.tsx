"use client";

import {
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  CollegeBranding,
  collegeBranding,
} from "@/components/college-branding";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

type LoginHint = {
  identifier: string;
  collegeCode: string;
  remember: boolean;
};

function readLoginHint(): LoginHint {
  if (typeof window === "undefined")
    return { identifier: "", collegeCode: "", remember: false };
  const saved = window.localStorage.getItem("avs_login_hint");
  if (!saved) return { identifier: "", collegeCode: "", remember: false };
  try {
    const parsed = JSON.parse(saved) as {
      identifier?: string;
      collegeCode?: string;
    };
    return {
      identifier: parsed.identifier ?? "",
      collegeCode: parsed.collegeCode ?? "",
      remember: true,
    };
  } catch {
    window.localStorage.removeItem("avs_login_hint");
    return { identifier: "", collegeCode: "", remember: false };
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [savedHint] = useState(readLoginHint);
  const [identifier, setIdentifier] = useState(savedHint.identifier);
  const [password, setPassword] = useState("");
  const [collegeCode, setCollegeCode] = useState(savedHint.collegeCode);
  const [remember, setRemember] = useState(savedHint.remember);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Prefetch the dashboard and change-password pages so navigation is instant after login
  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/change-password");
  }, [router]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(identifier, password, collegeCode || undefined);
      if (remember)
        window.localStorage.setItem(
          "avs_login_hint",
          JSON.stringify({ identifier, collegeCode }),
        );
      else window.localStorage.removeItem("avs_login_hint");
      router.push(user.allowedNextRoute ?? (user.mustChangePassword ? "/change-password" : "/"));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Sign-in failed. Check your connection and try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <CollegeBranding priority />
        <div style={{ maxWidth: 560, position: "relative", zIndex: 1 }}>
          <span className="eyebrow" style={{ color: "#bfdbfe" }}>
            Campus Management System
          </span>
          <h1
            style={{
              fontSize: "clamp(2.25rem,5vw,4.2rem)",
              lineHeight: 1.04,
              margin: "16px 0 22px",
            }}
          >
            {collegeBranding.collegeName}
          </h1>
          <p
            style={{
              color: "#dbeafe",
              fontSize: "1.05rem",
              lineHeight: 1.7,
              maxWidth: 510,
            }}
          >
            Attendance, campus issue reporting, internal communication and
            administration in one secure AVS workspace.
          </p>
          <div style={{ display: "grid", gap: 14, marginTop: 34 }}>
            {[
              "Role and scope protected",
              "Real campus service updates",
              "Works on phones and desktops",
            ].map((item) => (
              <div
                key={item}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <CheckCircle2 size={19} color="#93c5fd" />
                {item}
              </div>
            ))}
          </div>
        </div>
        <small style={{ color: "#bfdbfe", position: "relative", zIndex: 1 }}>
          Authorized AVS users only
        </small>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <CollegeBranding className="auth-form-branding" priority />
          <span className="eyebrow auth-welcome">Welcome back</span>
          <h1 className="auth-title">Sign in</h1>
          <p className="muted auth-description">
            Use your college ID or official email. Accounts are created by the
            administrator.
          </p>
          {error && (
            <div className="error-box" style={{ marginBottom: 18 }}>
              {error}
            </div>
          )}
          <div className="auth-fields">
            <div className="field">
              <label htmlFor="identifier">College ID or Email</label>
              <input
                className="input"
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="collegeCode">
                College code{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (if requested)
                </span>
              </label>
              <input
                className="input"
                id="collegeCode"
                value={collegeCode}
                onChange={(e) => setCollegeCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <label htmlFor="password">Password</label>
                <Link
                  href="/forgot-password"
                  style={{ color: "var(--primary)", fontWeight: 650 }}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  style={{ paddingRight: 46 }}
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    right: 5,
                    top: 1,
                    width: 40,
                    minHeight: 40,
                    border: 0,
                    background: "transparent",
                    color: "var(--muted)",
                  }}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>
            <label className="check-field" style={{ color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember this device
            </label>
            <button
              className="btn btn-primary"
              disabled={busy}
              style={{ width: "100%", marginTop: 5 }}
            >
              {busy ? (
                "Signing in..."
              ) : (
                <>
                  <LockKeyhole size={18} />
                  Login
                </>
              )}
            </button>
          </div>
          <div className="auth-security">
            <ShieldCheck
              size={19}
              style={{ flex: "0 0 auto", color: "var(--success)" }}
            />
            <small>
              Your session is protected. Never share your temporary password or
              verification code.
            </small>
          </div>
        </form>
      </section>
    </main>
  );
}
