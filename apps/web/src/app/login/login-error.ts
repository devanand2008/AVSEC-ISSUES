import { ApiError, ApiNetworkError } from "@/lib/api";

export function loginErrorMessage(
  error: unknown,
  online = typeof navigator === "undefined" || navigator.onLine,
): string {
  if (
    !online ||
    (error instanceof ApiNetworkError && error.kind === "offline")
  ) {
    return "You are offline. Reconnect to the internet and try again.";
  }
  if (error instanceof ApiNetworkError) {
    return error.kind === "timeout"
      ? "The AVS server is taking longer than expected to start. Please wait a moment and try again."
      : "The AVS server could not be reached. It may be starting up; please wait a moment and try again.";
  }
  if (error instanceof ApiError) {
    let message: string;
    if (error.status === 401) {
      message = "Incorrect college ID, email, password, or college code.";
    } else if (error.status === 403) {
      const reason = error.message.toLowerCase();
      message = reason.includes("suspend")
        ? "This account is suspended. Contact the college administrator for access."
        : reason.includes("archiv") || reason.includes("inactive")
          ? "This account is archived or inactive. Contact the college administrator for access."
          : "This account is not permitted to sign in. Contact the college administrator for access.";
    } else if (error.status === 409) {
      message =
        "Your account requires a password or profile action before sign-in can continue. Complete the required action or contact the college administrator.";
    } else if (error.status === 404) {
      message =
        "The sign-in service is unavailable in this app version. Refresh or update the installed app, then try again.";
    } else if (error.status === 429) {
      message = "Too many sign-in attempts. Please wait before trying again.";
    } else if ([502, 503, 504].includes(error.status)) {
      message =
        "The AVS server is starting or temporarily unavailable. Please wait a moment and try again.";
    } else if (error.status >= 500) {
      message =
        "The AVS server could not complete sign-in. Please try again shortly.";
    } else {
      message = error.message;
    }
    return error.requestId
      ? `${message} Reference: ${error.requestId}.`
      : message;
  }
  return "An unexpected sign-in error occurred. Please refresh the app and try again.";
}
