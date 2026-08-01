"use client";

import { useAuth } from "@/providers/auth-provider";
import { AdminDashboard } from "@/features/dashboard/admin-dashboard";
import { StudentDashboard } from "@/features/dashboard/student-dashboard";
import { FacultyDashboard } from "@/features/dashboard/faculty-dashboard";
import { MaintenanceDashboard } from "@/features/dashboard/maintenance-dashboard";
import { LeadershipDashboard } from "@/features/dashboard/leadership-dashboard";
import { HodDashboard } from "@/features/dashboard/hod-dashboard";
import { StaffDashboard } from "@/features/dashboard/staff-dashboard";
import { dashboardKindForRoles } from "@/features/dashboard/dashboard-role";

export default function DashboardPage() {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const dashboard = dashboardKindForRoles(user.roles);
  if (dashboard === "admin") return <AdminDashboard />;
  if (dashboard === "principal") return <LeadershipDashboard variant="principal" />;
  if (dashboard === "vice-principal") return <LeadershipDashboard variant="vice-principal" />;
  if (dashboard === "hod") return <HodDashboard />;
  if (dashboard === "faculty") return <FacultyDashboard />;
  if (dashboard === "maintenance") return <MaintenanceDashboard />;
  if (dashboard === "student") return <StudentDashboard />;
  return <StaffDashboard />;
}
