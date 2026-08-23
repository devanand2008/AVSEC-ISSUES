const RETRYABLE_IMPORT_ERROR_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  "P2034",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

const RETRYABLE_IMPORT_ERROR_NAMES = new Set([
  "InternalError",
  "NetworkingError",
  "RequestTimeout",
  "RequestTimeoutException",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
  "TimeoutError",
  "TooManyRequestsException",
]);

export class RetryableImportInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableImportInfrastructureError";
  }
}

/**
 * Identifies failures for which replay is safe only after the import ledger is
 * reconciled. Keep domain and constraint errors out of this predicate so they
 * can still be reported against their individual workbook rows.
 */
export function isRetryableImportInfrastructureError(error: unknown): boolean {
  if (error instanceof RetryableImportInfrastructureError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    $retryable?: unknown;
  };
  if (
    typeof candidate.code === "string" &&
    RETRYABLE_IMPORT_ERROR_CODES.has(candidate.code)
  ) {
    return true;
  }
  if (
    typeof candidate.name === "string" &&
    RETRYABLE_IMPORT_ERROR_NAMES.has(candidate.name)
  ) {
    return true;
  }
  if (
    candidate.$retryable === true ||
    (candidate.$retryable !== null && typeof candidate.$retryable === "object")
  ) {
    return true;
  }

  const status = candidate.$metadata?.httpStatusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}
