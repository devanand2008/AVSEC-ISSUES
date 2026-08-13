import { ApiError, ApiNetworkError } from "@/lib/api";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

interface PasswordIdentity {
  fullName: string;
  email: string | null;
}

const SAFE_CONFLICT_MESSAGES = new Set([
  "The new password must be different.",
  "The new password must not contain your college ID.",
  "The new password must not contain your email address.",
  "The new password must not contain your name.",
]);

export function passwordChecks(
  currentPassword: string,
  newPassword: string,
): PasswordCheck[] {
  return [
    {
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      ok: newPassword.length >= MIN_PASSWORD_LENGTH,
    },
    { label: "Uppercase letter", ok: /[A-Z]/.test(newPassword) },
    { label: "Lowercase letter", ok: /[a-z]/.test(newPassword) },
    { label: "Number", ok: /\d/.test(newPassword) },
    {
      label: "Special character",
      ok: /[^A-Za-z0-9]/.test(newPassword),
    },
    {
      label: "Different from temporary password",
      ok: Boolean(newPassword) && newPassword !== currentPassword,
    },
  ];
}

export function passwordIdentityCheck(
  newPassword: string,
  identity: PasswordIdentity,
): PasswordCheck {
  const loweredNewPassword = newPassword.toLowerCase();
  const email = identity.email?.toLowerCase();
  const nameTokens = identity.fullName
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3);
  const containsIdentity =
    Boolean(email && loweredNewPassword.includes(email)) ||
    nameTokens.some((part) => loweredNewPassword.includes(part));

  return {
    label: "Does not contain your name or email address",
    ok: Boolean(newPassword) && !containsIdentity,
  };
}

export function passwordInputError(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): string | null {
  if (!currentPassword) return "Enter your temporary password.";
  if (currentPassword.length > MAX_PASSWORD_LENGTH) {
    return "The temporary password is too long.";
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return "The new password is too long.";
  }
  if (confirmPassword.length > MAX_PASSWORD_LENGTH) {
    return "The confirmed password is too long.";
  }
  return null;
}

export function passwordChangeErrorMessage(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    if (error.kind === "offline") {
      return "This device is offline. Reconnect to the internet and try again.";
    }
    if (error.kind === "timeout") {
      return "The AVS server took too long to respond. Refresh this page to check whether the change completed before submitting again.";
    }
    return "The AVS server could not be reached. Check your connection and try again.";
  }

  if (!(error instanceof ApiError)) {
    return "Password change failed. Please try again.";
  }

  if (error.status === 400) {
    return "The new password does not meet every password requirement. Review the checklist and try again.";
  }

  if (error.status === 401) {
    return "The temporary password is incorrect or your session expired. Check it and try again; sign in again if the problem continues.";
  }

  if (error.status === 403) {
    return "Your secure session could not be verified. Refresh the page and sign in again.";
  }

  if (error.status === 409) {
    return SAFE_CONFLICT_MESSAGES.has(error.message)
      ? error.message
      : "The new password conflicts with the account password policy. Choose a different password.";
  }

  if (error.status === 429) {
    return "Too many password attempts. Wait a moment and try again.";
  }

  if (error.status >= 500) {
    return "The AVS server could not change the password right now. Please try again.";
  }

  return "Password change failed. Please try again.";
}
