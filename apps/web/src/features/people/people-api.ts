export const PEOPLE_BACKUPS_ENDPOINT = "/admin/backups";

export function canResetPersonPassword(
  actor: { id: string; permissions: string[] } | null | undefined,
  person: { publicId: string; status: string; archivedAt: string | null },
): boolean {
  return Boolean(
    actor?.permissions.includes("users.reset_password") &&
      actor.id !== person.publicId &&
      person.status !== "ARCHIVED" &&
      !person.archivedAt,
  );
}

export interface DeletionBackupCandidate {
  status: string;
  backupType: string;
  completedAt?: string;
  lastRestoreTest?: { status: string };
}

export function isRestoreTestedPreDeletionBackup(
  backup: DeletionBackupCandidate,
  archivedAt: string | null | undefined,
): boolean {
  if (
    backup.status !== "RESTORE_TESTED" ||
    backup.backupType !== "PRE_DELETION" ||
    backup.lastRestoreTest?.status !== "PASSED" ||
    !backup.completedAt ||
    !archivedAt
  ) {
    return false;
  }
  return (
    new Date(backup.completedAt).getTime() >= new Date(archivedAt).getTime()
  );
}
