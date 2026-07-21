import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// npm workspaces execute this file with apps/api as the working directory,
// while direct Prisma commands may execute from the repository root.
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

// Prisma validates the URL format without connecting to the database. This
// non-routable value keeps generate/validate reproducible in a clean checkout;
// the runtime environment schema still requires an explicit DATABASE_URL.
const datasourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://validation:validation@127.0.0.1:1/validation?schema=public&connect_timeout=1";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
});
