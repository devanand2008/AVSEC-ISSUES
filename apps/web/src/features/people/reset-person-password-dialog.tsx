"use client";

import { Key, Clipboard } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/api";
import { isStrongTemporaryPassword } from "./create-person";

interface ResetPersonPasswordDialogProps {
  person: { publicId: string; fullName: string; collegeIdentityId: string };
  onClose: () => void;
  onReset: () => void;
}

export function ResetPersonPasswordDialog({
  person,
  onClose,
  onReset,
}: ResetPersonPasswordDialogProps) {
  const fieldId = useId();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [issuedPassword, setIssuedPassword] = useState("");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const temporaryPassword = password.trim();
  const resetReason = reason.trim();
  const weakPassword = Boolean(temporaryPassword) &&
    !isStrongTemporaryPassword(temporaryPassword);
  const valid = resetReason.length >= 3 && resetReason.length <= 500 &&
    !weakPassword;

  async function resetPassword() {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        `/users/${person.publicId}/reset-password`,
        {
          reason: resetReason,
          requirePasswordChange: true,
          ...(temporaryPassword ? { temporaryPassword } : {}),
        },
        undefined,
        { cache: "no-store" },
      );
      setPassword("");
      setIssuedPassword(result.temporaryPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The password could not be reset.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(issuedPassword);
      setCopyMessage("Password copied.");
    } catch {
      setCopyMessage("Clipboard unavailable. Select the password to copy it manually.");
    }
  }

  const complete = Boolean(issuedPassword);
  return (
    <ConfirmationDialog
      open
      onClose={() => {
        if (submitting.current) return;
        onClose();
        if (complete) onReset();
      }}
      onConfirm={() => void (complete ? copyPassword() : resetPassword())}
      title={complete ? "Password reset" : "Reset password"}
      description={complete
        ? "Share the temporary password privately. It is available here until you close this dialog."
        : "This signs the user out of active sessions. They will choose a new password the next time they sign in."}
      icon={complete ? <Clipboard size={20} aria-hidden /> : <Key size={20} aria-hidden />}
      confirmLabel={complete ? "Copy password" : "Reset password"}
      cancelLabel={complete ? "Done" : "Cancel"}
      loading={pending}
      confirmDisabled={!complete && !valid}
    >
      <div className="grid gap-4" style={{ marginTop: "var(--space-4)" }}>
        <p style={{ margin: 0 }}>
          <strong>{person.fullName}</strong> · {person.collegeIdentityId}
        </p>
        {complete ? (
          <div className="field">
            <label htmlFor={`${fieldId}-issued`}>Temporary password</label>
            <input
              id={`${fieldId}-issued`}
              className="avs-input"
              value={issuedPassword}
              autoComplete="off"
              spellCheck={false}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <span role="status">{copyMessage}</span>
          </div>
        ) : (
          <>
            {error && <div className="error-box" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor={`${fieldId}-password`}>Temporary password (optional)</label>
              <input
                id={`${fieldId}-password`}
                className="avs-input"
                type="password"
                autoComplete="new-password"
                aria-describedby={`${fieldId}-hint`}
                aria-invalid={weakPassword || undefined}
                maxLength={200}
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small id={`${fieldId}-hint`}>
                Leave blank to generate a password. Use at least 12 characters with uppercase, lowercase, a number, and a symbol if you enter your own.
              </small>
            </div>
            <div className="field">
              <label htmlFor={`${fieldId}-reason`}>Reason for reset</label>
              <textarea
                id={`${fieldId}-reason`}
                className="avs-input"
                rows={3}
                required
                minLength={3}
                maxLength={500}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </ConfirmationDialog>
  );
}
