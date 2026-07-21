export type AccountStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "DISABLED"
  | "GRADUATED"
  | "RESIGNED"
  | "ARCHIVED";

export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "EMERGENCY";

export type IssueStatus =
  | "NEW"
  | "NEEDS_MANUAL_ASSIGNMENT"
  | "ASSIGNED"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "WAITING_FOR_MATERIAL"
  | "WAITING_FOR_VENDOR"
  | "ON_HOLD"
  | "RESOLVED"
  | "VERIFICATION_PENDING"
  | "VERIFIED"
  | "CLOSED"
  | "REOPENED"
  | "REJECTED"
  | "CANCELLED";

export type AttendanceCode =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "ON_DUTY"
  | "MEDICAL_LEAVE"
  | "AUTHORIZED_LEAVE";

export type ScopeType =
  | "COLLEGE"
  | "CAMPUS"
  | "DEPARTMENT"
  | "PROGRAMME"
  | "ACADEMIC_YEAR"
  | "SEMESTER"
  | "SECTION"
  | "BLOCK"
  | "FLOOR"
  | "ROOM"
  | "ISSUE_CATEGORY"
  | "ASSIGNED_ISSUES";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Array<{ field?: string; message: string }>;
  };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface PageResponse<T> {
  data: T[];
  meta: PageMeta;
}

export interface AuthenticatedUser {
  id: string;
  publicId: string;
  fullName: string;
  email: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  firstLoginCompletedAt?: string | null;
  roles: string[];
  permissions: string[];
}

export interface NotificationInput {
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  priority?: IssuePriority;
  data?: Record<string, unknown>;
}

export interface NotificationResult {
  accepted: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}
