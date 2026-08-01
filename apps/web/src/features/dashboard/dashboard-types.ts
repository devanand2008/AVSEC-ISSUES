export interface DashboardMetrics {
  openIssues: number;
  newIssues: number;
  unassignedIssues: number;
  criticalIssues: number;
  overdueIssues: number;
  resolvedToday: number;
  unreadNotifications: number;
  averageAcknowledgementMinutes: number | null;
  averageResolutionMinutes: number | null;
  slaCompliancePercentage: number | null;
  escalatedIssues: number;
  notificationFailures: number;
}

export interface DashboardIssue {
  id: string;
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  recentIssues: DashboardIssue[];
}
