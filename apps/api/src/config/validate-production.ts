import { config } from "dotenv";
import { resolve } from "node:path";
import { validateEnvironment } from "./environment";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

if (process.env.NODE_ENV !== "production") {
  throw new Error(
    "Production preflight failed: NODE_ENV must be production in .env.",
  );
}

validateEnvironment(process.env);
process.stdout.write("Production environment preflight passed.\n");
