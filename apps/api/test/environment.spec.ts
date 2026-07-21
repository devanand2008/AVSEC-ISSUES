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
