import { validateEnvironment } from "../src/config/environment";

const base = {
  NODE_ENV: "production",
  WEB_URL: "https://college.example",
  TRUST_PROXY: "1",
  DATABASE_URL:
    "postgresql://college_app:strong-password@postgres:5432/college_management",
  POSTGRES_PASSWORD: "strong-password",
  REDIS_URL: "redis://redis:6379",
  JWT_ACCESS_SECRET: "access-secret-0123456789-abcdef-2026",
  JWT_REFRESH_SECRET: "refresh-secret-fedcba9876543210-2026",
  CSRF_SECRET: "csrf-secret-abcdef0123456789-2026",
  COOKIE_SECURE: "true",
  SWAGGER_ENABLED: "false",
  SEED_DEVELOPMENT_DATA: "false",
  S3_ENDPOINT: "http://minio:9000",
  S3_ACCESS_KEY: "production-storage-user",
  S3_SECRET_KEY: "production-storage-secret",
  WHATSAPP_ENABLED: "false",
  EMAIL_ENABLED: "false",
  MALWARE_SCAN_ENABLED: "false",
};

describe("environment policy", () => {
  it("accepts a hardened production environment and resolves proxy hops", () => {
    const environment = validateEnvironment(base);
    expect(environment.TRUST_PROXY).toBe(1);
    expect(environment.GLOBAL_RATE_LIMIT_MAX).toBe(120);
  });

  it("uses Render's public URL for same-origin production defaults", () => {
    const environment = validateEnvironment({
      ...base,
      WEB_URL: undefined,
      RENDER_EXTERNAL_URL: "https://avs-college-portal.onrender.com/",
    });
    expect(environment.WEB_URL).toBe("https://avs-college-portal.onrender.com");
    expect(environment.PUBLIC_APP_URL).toBe(
      "https://avs-college-portal.onrender.com",
    );
    expect(environment.CORS_ALLOWED_ORIGINS).toBe(
      "https://avs-college-portal.onrender.com",
    );
  });

  it("rejects insecure production defaults", () => {
    expect(() =>
      validateEnvironment({
        ...base,
        WEB_URL: "http://localhost:3000",
        COOKIE_SECURE: "false",
        SWAGGER_ENABLED: "true",
        SEED_DEVELOPMENT_DATA: "true",
        S3_ACCESS_KEY: "minioadmin",
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it("requires provider fields only when their providers are enabled", () => {
    expect(() =>
      validateEnvironment({ ...base, WHATSAPP_ENABLED: "true" }),
    ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(() =>
      validateEnvironment({ ...base, MALWARE_SCAN_ENABLED: "true" }),
    ).toThrow(/MALWARE_SCAN_URL/);
    expect(() =>
      validateEnvironment({ ...base, EMAIL_ENABLED: "true" }),
    ).toThrow(/SMTP_HOST/);
    expect(() =>
      validateEnvironment({
        ...base,
        EMAIL_ENABLED: "true",
        SMTP_HOST: "smtp.example.edu",
        EMAIL_FROM_ADDRESS: "alerts@example.edu",
        SMTP_USERNAME: "college-alerts",
      }),
    ).toThrow(/SMTP_PASSWORD/);
    expect(() =>
      validateEnvironment({ ...base, AVS_BOT_ENABLED: "true" }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      validateEnvironment({
        ...base,
        AI_KNOWLEDGE_PROVIDER: "openai_file_search",
      }),
    ).toThrow(/OPENAI_VECTOR_STORE_ID/);
    expect(() =>
      validateEnvironment({ ...base, GOOGLE_DRIVE_ENABLED: "true" }),
    ).toThrow(/GOOGLE_DRIVE_OWNER_EMAIL/);
    expect(() =>
      validateEnvironment({ ...base, BACKUP_SCHEDULE_ENABLED: "true" }),
    ).toThrow(/BACKUP_ENCRYPTION_KEY/);
  });

  it("accepts complete backend-only Google Drive and encrypted backup settings", () => {
    const environment = validateEnvironment({
      ...base,
      GOOGLE_DRIVE_ENABLED: "true",
      GOOGLE_DRIVE_OWNER_EMAIL: "storage-owner@example.edu",
      GOOGLE_OAUTH_CLIENT_ID: "oauth-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET:
        "ci-oauth-client-secret-with-at-least-32-characters",
      GOOGLE_OAUTH_REDIRECT_URI:
        "https://college.example/api/v1/admin/storage/google-drive/callback",
      GOOGLE_DRIVE_ENCRYPTION_KEY:
        "ci-drive-token-key-with-at-least-32-random-characters",
      BACKUP_ENCRYPTION_KEY: "ci-backup-key-with-at-least-32-random-characters",
      BACKUP_SCHEDULE_ENABLED: "true",
    });
    expect(environment.GOOGLE_DRIVE_ENABLED).toBe(true);
    expect(environment.GOOGLE_DRIVE_MAX_FILE_SIZE_MB).toBe(500);
    expect(environment.GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE_MB).toBe(8);
    expect(environment.BACKUP_SCHEDULE_HOUR).toBe(2);
    expect(environment.BACKUP_DAILY_RETENTION).toBe(14);
    expect(environment.BACKUP_WEEKLY_RETENTION).toBe(12);
    expect(environment.BACKUP_MONTHLY_RETENTION).toBe(24);
  });

  it("accepts AVS Bot only with server key and explicitly configured model", () => {
    const environment = validateEnvironment({
      ...base,
      AVS_BOT_ENABLED: "true",
      OPENAI_API_KEY: "test-server-key-with-more-than-20-characters",
      OPENAI_MODEL: "project-available-model",
    });
    expect(environment.AVS_BOT_ENABLED).toBe(true);
    expect(environment.OPENAI_MODEL).toBe("project-available-model");
  });

  it("accepts complete SMTP configuration", () => {
    const environment = validateEnvironment({
      ...base,
      EMAIL_ENABLED: "true",
      SMTP_HOST: "smtp.example.edu",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      EMAIL_FROM_ADDRESS: "alerts@example.edu",
      SMTP_USERNAME: "college-alerts",
      SMTP_PASSWORD: "smtp-password-0123456789",
    });
    expect(environment.EMAIL_ENABLED).toBe(true);
    expect(environment.SMTP_SECURE).toBe(true);
  });
});
