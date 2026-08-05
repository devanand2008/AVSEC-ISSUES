import { StorageDashboard } from "@/app/(portal)/settings/storage/storage-dashboard";

export const metadata = {
  title: "Database and Backups — AVS College Management System",
  description:
    "Monitor PostgreSQL connection, manage encrypted SQL backups, verify Google Drive upload status, and run restore tests.",
};

/**
 * Admin → System → Database and Backups
 *
 * Delegates to the canonical StorageDashboard component which provides:
 * - Database connection status and mode (EXTERNAL_PERSISTENT / RENDER_FREE_PILOT)
 * - Pilot database warning when running on a temporary free PostgreSQL
 * - Google Drive connection status and OAuth management
 * - Backup history with filename, size, encryption, checksum, Drive upload status
 * - Actions: Create Manual Backup, Download Schema SQL, Verify, Restore Test, Delete
 * - Retention policy display (daily / weekly / monthly)
 * - GitHub Actions cron schedule display
 */
export default function DatabaseBackupsPage() {
  return <StorageDashboard />;
}
