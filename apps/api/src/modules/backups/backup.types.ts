export const BACKUP_ID_PATTERN = /^backup-\d{8}T\d{6}Z-[a-f0-9]{12}$/;

export interface BackupManifest {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  artifact: {
    fileName: string;
    format: "avs-aes-256-gcm-v1";
    bytes: number;
    sha256: string;
  };
  dump: {
    format: "postgresql-custom";
    bytes: number;
    sha256: string;
  };
  encryption: {
    algorithm: "aes-256-gcm";
    keyId: string;
  };
  verification: {
    verifiedAt: string;
    pgRestoreList: true;
  };
  manifestHmacSha256: string;
}

export interface BackupRecord {
  manifest: BackupManifest;
  manifestPath: string;
  artifactPath: string;
}

export interface InvalidBackupRecord {
  fileName: string;
  reason: string;
}

export interface BackupInventory {
  backups: BackupRecord[];
  invalid: InvalidBackupRecord[];
}

export interface RetentionPolicy {
  maxBackups: number;
  maxAgeDays: number;
  minBackups: number;
  dailyBackups: number;
  weeklyBackups: number;
  monthlyBackups: number;
}

export interface RetentionResult {
  deletedIds: string[];
  retainedIds: string[];
  errors: Array<{ id: string; reason: string }>;
}

export interface EncryptionResult {
  artifactBytes: number;
  artifactSha256: string;
  plaintextBytes: number;
  plaintextSha256: string;
  keyId: string;
  nonceBase64: string;
}

export interface DecryptionResult {
  plaintextBytes: number;
  plaintextSha256: string;
}

export interface SafeCommand {
  executable: "pg_dump" | "pg_restore" | "createdb" | "dropdb" | "psql";
  args: string[];
  environment: Record<string, string>;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandExecutor {
  run(command: SafeCommand): Promise<CommandResult>;
}

export interface RestoreVerificationResult {
  temporaryDatabaseHash: string;
  recordCountComparison: {
    source: { users: number; migrations: number };
    restored: { users: number; migrations: number };
    matches: boolean;
  };
  schemaComparison: {
    sourceTableCount: number;
    restoredTableCount: number;
    matches: boolean;
  };
}
