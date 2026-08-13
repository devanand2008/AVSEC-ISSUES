"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CollegeBranding } from "@/components/college-branding";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordChangeErrorMessage,
  passwordChecks,
  passwordIdentityCheck,
  passwordInputError,
} from "@/features/auth/change-password";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

function strengthLevel(checks: ReturnType<typeof passwordChecks>): number {
  return checks.filter((c) => c.ok).length; // 0-6
}

function strengthLabel(level: number): string {
  if (level <= 1) return "Very weak";
  if (level <= 2) return "Weak";
  if (level <= 3) return "Fair";
  if (level <= 4) return "Good";
  if (level <= 5) return "Strong";
  return "Very strong";
}

function strengthColor(level: number): string {
  if (level <= 1) return "#ef4444";
  if (level <= 2) return "#f97316";
  if (level <= 3) return "#eab308";
  if (level <= 4) return "#22c55e";
  return "#16a34a";
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { user, loading, refetch } = useAuth();

  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Use a ref for the busy guard so it survives re-renders without causing
  // stale-closure bugs. A state-only guard can miss a second tap that arrives
  // before the state update propagates.
  const busyRef = useRef(false);
  const [busyDisplay, setBusyDisplay] = useState(false); // for UI only

  const checks = passwordChecks(currentPassword, newPassword);
  const identityCheck = passwordIdentityCheck(newPassword, {
    fullName: user?.fullName ?? "",
    email: user?.email ?? null,
  });
  const structuralStrength = strengthLevel(checks);
  const strength = identityCheck.ok ? structuralStrength : 0;
  const displayedStrengthLabel = identityCheck.ok
    ? strengthLabel(structuralStrength)
    : "Not allowed";

  // We only redirect to "/" if:
  //   1. The user is loaded AND
  //   2. mustChangePassword is FALSE AND
  //   3. We did NOT just successfully submit (saved=true covers that transition)
  //
  // This prevents the case where the page flashes after a successful submit
  // before router.replace fires.

  useEffect(() => {
    if (loading) return undefined;
    if (!user) {
      router.replace("/login");
      return undefined;
    }
    // If the backend says password has already been changed and this is NOT a
    // fresh successful submit, redirect away immediately.
    if (!user.mustChangePassword && !saved) {
      const timeout = window.setTimeout(() => router.replace("/"), 300);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [loading, router, saved, user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    // Double-tap / double-submit guard (ref-based, not state-based)
    if (busyRef.current) return;

    const inputError = passwordInputError(
      currentPassword,
      newPassword,
      confirm,
    );
    if (inputError) {
      setError(inputError);
      return;
    }
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    if (checks.some((check) => !check.ok) || !identityCheck.ok) {
      setError("Complete every password requirement before saving.");
      return;
    }

    busyRef.current = true;
    setBusyDisplay(true);
    setError("");

    try {
      // 1. Send the change-password request to the backend.
      //    The backend atomically hashes the new password, sets
      //    mustChangePassword=false, sets firstLoginCompletedAt,
      //    revokes old sessions and returns fresh tokens + updated user.
      const result = await api.post<{ user: User }>("/auth/change-password", {
        currentPassword,
        newPassword,
      });

      // 2. Immediately update the React Query cache with the server response.
      //    This is the authoritative state; do not construct it locally.
      await client.cancelQueries({ queryKey: ["me"] });
      client.setQueryData(["me"], result.user);

      // 3. Mark as saved BEFORE the async refetch so the useEffect above
      //    does not incorrectly trigger a re-redirect if the user has
      //    mustChangePassword=false in the new response.
      setSaved(true);

      // 4. Refetch in the background to sync any other query consumers.
      //    We do not await this because the cache is already correct.
      void refetch();

      // 5. Navigate away. router.replace is synchronous in Next.js App
      //    Router and does not cause a page reload, so BFCache is not
      //    involved here.
      router.replace(result.user.allowedNextRoute ?? "/");
    } catch (caught: unknown) {
      setError(passwordChangeErrorMessage(caught));
      busyRef.current = false;
      setBusyDisplay(false);
    }
    // Note: we do NOT reset busyRef.current = false on success because we
    // immediately navigate away. Resetting it would allow a second tap to
    // fire during navigation.
  };

  if (loading || !user || (!user.mustChangePassword && !saved)) {
    return (
      <main className="change-pw-page">
        <section className="change-pw-card">
          <div className="change-pw-brand">
            <CollegeBranding />
          </div>
          <div className="change-pw-already">
            <CheckCircle2
              size={22}
              style={{ color: user ? "var(--success)" : "var(--muted)" }}
            />
            <strong>
              {user
                ? "Your password has already been changed."
                : "Checking your session..."}
            </strong>
          </div>
          <p className="change-pw-sub">
            {user ? "Redirecting to your dashboard." : "Please wait."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="change-pw-page">
      <form className="change-pw-card" onSubmit={submit} noValidate>
        {/* Branding */}
        <div className="change-pw-brand">
          <CollegeBranding />
        </div>

        <span className="eyebrow" style={{ marginTop: 4 }}>
          First sign-in
        </span>
        <h1 className="change-pw-title">Create a private password</h1>
        <p className="change-pw-sub">
          Your temporary password must be replaced before you continue.
        </p>

        {/* Error banner */}
        {error && (
          <div className="error-box" style={{ marginBottom: 16 }} role="alert">
            {error}
          </div>
        )}

        {/* Success banner, briefly visible before navigation */}
        {saved && (
          <div className="change-pw-success" role="status">
            <CheckCircle2 size={18} />
            Your password was updated successfully. Redirecting...
          </div>
        )}

        <div className="change-pw-fields">
          {/* Temporary password */}
          <div className="field">
            <label htmlFor="current">Temporary password</label>
            <PasswordInput
              id="current"
              value={currentPassword}
              visible={showCurrent}
              onVisibleChange={() => setShowCurrent((v) => !v)}
              onChange={setCurrent}
              autoComplete="current-password"
              maxLength={MAX_PASSWORD_LENGTH}
              disabled={busyDisplay || saved}
            />
          </div>

          {/* New password */}
          <div className="field">
            <label htmlFor="new">New password</label>
            <PasswordInput
              id="new"
              value={newPassword}
              visible={showNew}
              onVisibleChange={() => setShowNew((v) => !v)}
              onChange={setNew}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              disabled={busyDisplay || saved}
            />

            {/* Strength meter */}
            {newPassword.length > 0 && (
              <div className="change-pw-strength">
                <div className="change-pw-strength-bar">
                  {[1, 2, 3, 4, 5, 6].map((segment) => (
                    <div
                      key={segment}
                      className="change-pw-strength-segment"
                      style={{
                        background:
                          segment <= strength
                            ? strengthColor(strength)
                            : "var(--border)",
                      }}
                    />
                  ))}
                </div>
                <span
                  className="change-pw-strength-label"
                  style={{ color: strengthColor(strength) }}
                >
                  {displayedStrengthLabel}
                </span>
              </div>
            )}

            {/* Checklist */}
            <div className="password-checks">
              {checks.map((check) => (
                <span
                  className={check.ok ? "ok" : ""}
                  key={check.label}
                  aria-label={`${check.label}: ${check.ok ? "met" : "not met"}`}
                >
                  <CheckCircle2 size={14} aria-hidden="true" />
                  {check.label}
                  <span className="sr-only">
                    {check.ok ? " requirement met" : " requirement not met"}
                  </span>
                </span>
              ))}
              <span
                className={identityCheck.ok ? "ok" : ""}
                aria-label={`${identityCheck.label}: ${identityCheck.ok ? "met" : "not met"}`}
              >
                <CheckCircle2 size={14} aria-hidden="true" />
                {identityCheck.label}
                <span className="sr-only">
                  {identityCheck.ok
                    ? " requirement met"
                    : " requirement not met"}
                </span>
              </span>
            </div>
            <div className="change-pw-server-rule" role="note">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>
                Do not include your college ID. This additional identity check
                is securely verified when you save.
              </span>
            </div>
          </div>

          {/* Confirm password */}
          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <PasswordInput
              id="confirm"
              value={confirm}
              visible={showConfirm}
              onVisibleChange={() => setShowConfirm((v) => !v)}
              onChange={setConfirm}
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              disabled={busyDisplay || saved}
            />
            {confirm.length > 0 && newPassword !== confirm && (
              <small className="change-pw-mismatch">
                Passwords do not match.
              </small>
            )}
          </div>

          {/* Submit button */}
          <button
            className="btn btn-primary change-pw-btn"
            type="submit"
            disabled={busyDisplay || saved}
            aria-busy={busyDisplay}
          >
            <KeyRound size={18} />
            {busyDisplay ? "Saving..." : "Save password and continue"}
          </button>

          {/* Security note */}
          <div className="change-pw-security-note">
            <ShieldCheck
              size={16}
              style={{ color: "var(--success)", flexShrink: 0 }}
            />
            <small>
              Your new password is encrypted and never stored in plain text.
              Temporary passwords cannot be reused after this step.
            </small>
          </div>
        </div>
      </form>
    </main>
  );
}

function PasswordInput({
  id,
  value,
  visible,
  autoComplete,
  minLength,
  maxLength,
  disabled,
  onChange,
  onVisibleChange,
}: {
  id: string;
  value: string;
  visible: boolean;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  onVisibleChange: () => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        // Prevent zoom on iOS (minimum 16px font prevents auto-zoom)
        style={{ paddingRight: 52, fontSize: "max(16px, 1rem)" }}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={onVisibleChange}
        disabled={disabled}
        style={{
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          width: 44,
          height: 44,
          border: 0,
          background: "transparent",
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          borderRadius: 6,
        }}
      >
        {visible ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );
}
