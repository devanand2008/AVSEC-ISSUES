import { z } from "zod";

const booleanString = (defaultValue = false) =>
  z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(32).optional(),
);

const trustProxy = z
  .string()
  .default("false")
  .refine(
    (value) =>
      value === "false" || value === "true" || /^[1-9]\d*$/.test(value),
    {
      message: "must be false, true, or a positive proxy-hop count",
    },
  )
  .transform((value) =>
    value === "false" ? false : value === "true" ? 1 : Number(value),
  );

const knownExampleSecrets = new Set([
  "replace-with-at-least-32-random-characters",
  "replace-with-a-different-32-character-secret",
  "replace-with-a-dedicated-random-secret-of-at-least-32-characters",
  "replace-with-a-dedicated-feedback-secret-of-at-least-32-characters",
  "change-this-local-password",
  "change-this-minio-password",
  "ChangeMe-OnlyFor-Local-2026!",
  "deva1253",
  "minioadmin",
]);

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PREFIX: z
      .string()
      .trim()
      .regex(/^\/?[a-zA-Z0-9/_-]+$/)
      .default("api/v1")
      .transform((value) => value.replace(/^\/+|\/+$/g, "")),
    WEB_URL: z.url().default("http://localhost:3000"),
    TRUST_PROXY: trustProxy,
    GLOBAL_RATE_LIMIT_TTL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    GLOBAL_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(120),
    LOGIN_RATE_LIMIT_TTL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
    POSTGRES_PASSWORD: optionalString,
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default("15m"),
    JWT_REFRESH_EXPIRY: z.string().default("7d"),
    AUTH_REFRESH_DATABASE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(30_000)
      .default(5000),
    COOKIE_DOMAIN: optionalString,
    COOKIE_SECURE: booleanString(),
    COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    CSRF_SECRET: z.string().min(32),
    FEEDBACK_SUBMISSION_SECRET: optionalSecret,
    PASSWORD_PEPPER: z.string().default(""),
    LOG_LEVEL: z.string().default("info"),
    SWAGGER_ENABLED: booleanString(true),
    S3_ENDPOINT: z.url().default("http://localhost:9000"),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().default("college-private"),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: booleanString(true),
    S3_SIGNED_URL_EXPIRY_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(300),
    WHATSAPP_ENABLED: booleanString(),
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_API_VERSION: z.string().default("v23.0"),
    WHATSAPP_ISSUE_TEMPLATE_NAME: z
      .string()
      .default("college_issue_assignment"),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
    WHATSAPP_FEEDBACK_TEMPLATE_NAME: z
      .string()
      .default("college_feedback_alert"),
    EMAIL_ENABLED: booleanString(),
    EMAIL_PROVIDER: z.enum(["smtp"]).default("smtp"),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanString(),
    SMTP_USERNAME: optionalString,
    SMTP_PASSWORD: optionalString,
    EMAIL_FROM_NAME: z
      .string()
      .trim()
      .min(1)
      .default("AVS Engineering College"),
    EMAIL_FROM_ADDRESS: optionalString,
    FIREBASE_PROJECT_ID: optionalString,
    FIREBASE_CLIENT_EMAIL: optionalString,
    FIREBASE_PRIVATE_KEY: optionalString,
    DEVICE_TOKEN_ENCRYPTION_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    DEFAULT_TIMEZONE: z.string().default("Asia/Kolkata"),
    MAX_IMAGE_SIZE_MB: z.coerce.number().positive().default(10),
    MAX_VIDEO_SIZE_MB: z.coerce.number().positive().default(50),
    MAX_DOCUMENT_SIZE_MB: z.coerce.number().positive().default(15),
    MAX_AUDIO_SIZE_MB: z.coerce.number().positive().default(15),
    MALWARE_SCAN_ENABLED: booleanString(),
    MALWARE_SCAN_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    SEED_DEVELOPMENT_DATA: booleanString(),
    DEVELOPMENT_COLLEGE_CODE: optionalString,
    DEVELOPMENT_ADMIN_EMAIL: optionalString,
    DEVELOPMENT_ADMIN_NAME: optionalString,
    DEVELOPMENT_RESET_ADMIN_PASSWORD: optionalString,
    DEVELOPMENT_ADMIN_MUST_CHANGE_PASSWORD: optionalString,
    DEVELOPMENT_ADMIN_PASSWORD: optionalString,
  })
  .superRefine((environment, context) => {
    if (environment.WHATSAPP_ENABLED) {
      const required = [
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_BUSINESS_ACCOUNT_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_VERIFY_TOKEN",
        "WHATSAPP_APP_SECRET",
      ] as const;
      for (const field of required) {
        if (!environment[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: "is required when WHATSAPP_ENABLED=true",
          });
        }
      }
    }

    if (environment.EMAIL_ENABLED) {
      for (const field of ["SMTP_HOST", "EMAIL_FROM_ADDRESS"] as const) {
        if (!environment[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: "is required when EMAIL_ENABLED=true",
          });
        }
      }
      if (
        Boolean(environment.SMTP_USERNAME) !==
        Boolean(environment.SMTP_PASSWORD)
      ) {
        context.addIssue({
          code: "custom",
          path: [environment.SMTP_USERNAME ? "SMTP_PASSWORD" : "SMTP_USERNAME"],
          message: "must be provided together with the other SMTP credential",
        });
      }
    }

    if (environment.MALWARE_SCAN_ENABLED && !environment.MALWARE_SCAN_URL) {
      context.addIssue({
        code: "custom",
        path: ["MALWARE_SCAN_URL"],
        message: "is required when MALWARE_SCAN_ENABLED=true",
      });
    }

    if (environment.NODE_ENV !== "production") return;

    if (!environment.COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "must be true in production",
      });
    }
    if (environment.SWAGGER_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["SWAGGER_ENABLED"],
        message: "must be false in production",
      });
    }
    if (environment.SEED_DEVELOPMENT_DATA) {
      context.addIssue({
        code: "custom",
        path: ["SEED_DEVELOPMENT_DATA"],
        message: "must be false in production",
      });
    }
    if (environment.TRUST_PROXY === false) {
      context.addIssue({
        code: "custom",
        path: ["TRUST_PROXY"],
        message: "must identify at least one trusted proxy hop in production",
      });
    }

    const webUrl = new URL(environment.WEB_URL);
    if (
      webUrl.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(webUrl.hostname)
    ) {
      context.addIssue({
        code: "custom",
        path: ["WEB_URL"],
        message: "must be a non-local HTTPS URL in production",
      });
    }

    const secrets = [
      ["POSTGRES_PASSWORD", environment.POSTGRES_PASSWORD],
      ["JWT_ACCESS_SECRET", environment.JWT_ACCESS_SECRET],
      ["JWT_REFRESH_SECRET", environment.JWT_REFRESH_SECRET],
      ["CSRF_SECRET", environment.CSRF_SECRET],
      ["FEEDBACK_SUBMISSION_SECRET", environment.FEEDBACK_SUBMISSION_SECRET],
      ["S3_ACCESS_KEY", environment.S3_ACCESS_KEY],
      ["S3_SECRET_KEY", environment.S3_SECRET_KEY],
      ["DEVICE_TOKEN_ENCRYPTION_KEY", environment.DEVICE_TOKEN_ENCRYPTION_KEY],
      ["SMTP_PASSWORD", environment.SMTP_PASSWORD],
      ["DEVELOPMENT_ADMIN_PASSWORD", environment.DEVELOPMENT_ADMIN_PASSWORD],
    ] as const;
    for (const [field, value] of secrets) {
      if (
        value &&
        (knownExampleSecrets.has(value) ||
          /(?:replace-with|change-this|only-for-local)/i.test(value))
      ) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "must not use a documented example value in production",
        });
      }
    }
    if (/change-this|localhost|127\.0\.0\.1/i.test(environment.DATABASE_URL)) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message:
          "must use a non-local production connection without example credentials",
      });
    }
    if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "must differ from JWT_ACCESS_SECRET",
      });
    }
    if (
      [environment.JWT_ACCESS_SECRET, environment.JWT_REFRESH_SECRET].includes(
        environment.CSRF_SECRET,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["CSRF_SECRET"],
        message: "must be independent from JWT secrets",
      });
    }
    if (
      environment.FEEDBACK_SUBMISSION_SECRET &&
      [
        environment.JWT_ACCESS_SECRET,
        environment.JWT_REFRESH_SECRET,
        environment.CSRF_SECRET,
      ].includes(environment.FEEDBACK_SUBMISSION_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["FEEDBACK_SUBMISSION_SECRET"],
        message: "must be independent from JWT and CSRF secrets",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return result.data;
}
