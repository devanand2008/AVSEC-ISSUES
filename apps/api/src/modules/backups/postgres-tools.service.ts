import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type {
  CommandExecutor,
  RestoreVerificationResult,
  SafeCommand,
} from "./backup.types";
import { SafeProcessRunner } from "./safe-process-runner.service";

interface PostgreSqlConnection {
  host: string;
  port: string;
  username: string;
  database: string;
  environment: Record<string, string>;
}

const TEMPORARY_DATABASE_PATTERN = /^avs_backup_verify_[a-z0-9_]{12,64}$/;
const TABLE_INVENTORY_SQL =
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename";

function quotePostgreSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quotePostgreSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function recordCountsSql(tables: string[]): string {
  if (tables.length === 0) return "SELECT '{}'::json::text";
  const tableQueries = tables.map(
    (table) =>
      `SELECT ${quotePostgreSqlLiteral(table)} AS table_name, count(*)::bigint AS row_count FROM public.${quotePostgreSqlIdentifier(table)}`,
  );
  return `SELECT json_object_agg(table_name, row_count ORDER BY table_name)::text FROM (${tableQueries.join(" UNION ALL ")}) AS table_counts`;
}

export function parsePostgreSqlConnection(databaseUrl: string): PostgreSqlConnection {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/u, ""));
  const username = decodeURIComponent(url.username);
  if (!url.hostname || !username || !database || [url.hostname, username, database].some((part) => part.includes("\0"))) {
    throw new Error("DATABASE_URL must include a host, username, and database.");
  }

  const environment: Record<string, string> = {
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "15",
  };
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslMode)) {
    environment.PGSSLMODE = sslMode;
  }
  for (const [parameter, variable] of [
    ["sslrootcert", "PGSSLROOTCERT"],
    ["sslcert", "PGSSLCERT"],
    ["sslkey", "PGSSLKEY"],
  ] as const) {
    const value = url.searchParams.get(parameter);
    if (value && !value.includes("\0")) environment[variable] = value;
  }

  return {
    host: url.hostname,
    port: url.port || "5432",
    username,
    database,
    environment,
  };
}

function connectionArgs(connection: PostgreSqlConnection): string[] {
  return [
    "--host", connection.host,
    "--port", connection.port,
    "--username", connection.username,
  ];
}

function command(
  executable: SafeCommand["executable"],
  args: string[],
  connection: PostgreSqlConnection,
  timeoutMs: number,
): SafeCommand {
  return {
    executable,
    args,
    environment: connection.environment,
    timeoutMs,
  };
}

function assertTemporaryDatabaseName(database: string): void {
  if (!TEMPORARY_DATABASE_PATTERN.test(database)) {
    throw new Error("Restore target is not an internally generated temporary database.");
  }
}

@Injectable()
export class PostgresToolsService {
  constructor(private readonly executor: SafeProcessRunner) {}

  async tableRecordCounts(
    databaseUrl: string,
  ): Promise<Record<string, number>> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    const tables = await this.queryLines(
      connection,
      connection.database,
      TABLE_INVENTORY_SQL,
    );
    return this.queryCounts(connection, connection.database, tables);
  }

  async dump(databaseUrl: string, outputPath: string): Promise<void> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    await this.expectSuccess(command("pg_dump", [
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-acl",
      "--file", outputPath,
      ...connectionArgs(connection),
      "--dbname", connection.database,
    ], connection, 30 * 60 * 1000));
  }

  async dumpPlain(databaseUrl: string, outputPath: string): Promise<void> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    await this.expectSuccess(
      command(
        "pg_dump",
        [
          "--format=plain",
          "--no-owner",
          "--no-privileges",
          "--clean",
          "--if-exists",
          "--encoding=UTF8",
          "--file",
          outputPath,
          ...connectionArgs(connection),
          "--dbname",
          connection.database,
        ],
        connection,
        30 * 60 * 1000,
      ),
    );
  }

  async dumpSchema(databaseUrl: string, outputPath: string): Promise<void> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    await this.expectSuccess(
      command(
        "pg_dump",
        [
          "--schema-only",
          "--format=plain",
          "--no-owner",
          "--no-privileges",
          "--encoding=UTF8",
          "--file",
          outputPath,
          ...connectionArgs(connection),
          "--dbname",
          connection.database,
        ],
        connection,
        15 * 60 * 1000,
      ),
    );
  }

  async inspectSql(sqlPath: string): Promise<void> {
    const { open, stat } = await import("node:fs/promises");
    const details = await stat(sqlPath);
    if (!details.isFile() || details.size === 0) {
      throw new Error("PostgreSQL SQL backup is empty.");
    }
    const handle = await open(sqlPath, "r");
    try {
      const sample = Buffer.alloc(Math.min(details.size, 2 * 1024 * 1024));
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const sql = sample.subarray(0, bytesRead).toString("utf8");
      if (
        !sql.includes("PostgreSQL database dump") ||
        !/(?:CREATE TABLE|CREATE SCHEMA)/u.test(sql)
      ) {
        throw new Error(
          "PostgreSQL SQL backup does not contain an expected readable schema.",
        );
      }
    } finally {
      await handle.close();
    }
  }

  async inspectDump(dumpPath: string): Promise<void> {
    const result = await this.executor.run({
      executable: "pg_restore",
      args: ["--list", dumpPath],
      environment: {},
      timeoutMs: 5 * 60 * 1000,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      throw new Error("pg_restore could not read the backup catalog.");
    }
  }

  async restoreAndVerifyInTemporaryDatabase(
    databaseUrl: string,
    dumpPath: string,
    expectedRecordCounts?: Record<string, number>,
  ): Promise<RestoreVerificationResult> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    const temporaryDatabase = `avs_backup_verify_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
    assertTemporaryDatabaseName(temporaryDatabase);
    if (temporaryDatabase === connection.database) {
      throw new Error("Temporary restore database cannot be the configured application database.");
    }

    let created = false;
    let failure: unknown;
    let verification: RestoreVerificationResult | undefined;
    try {
      const sourceCounts =
        expectedRecordCounts ?? (await this.tableRecordCounts(databaseUrl));
      const sourceTables = Object.keys(sourceCounts).sort();
      await this.expectSuccess(command("createdb", [
        ...connectionArgs(connection),
        "--maintenance-db", "postgres",
        temporaryDatabase,
      ], connection, 60 * 1000));
      created = true;

      assertTemporaryDatabaseName(temporaryDatabase);
      await this.expectSuccess(command("pg_restore", [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
        ...connectionArgs(connection),
        "--dbname", temporaryDatabase,
        dumpPath,
      ], connection, 30 * 60 * 1000));

      const restoredTables = (
        await this.queryLines(
          connection,
          temporaryDatabase,
          TABLE_INVENTORY_SQL,
        )
      ).sort();
      const restoredCounts = await this.queryCounts(
        connection,
        temporaryDatabase,
        restoredTables,
      );
      const schemaMatches =
        sourceTables.length === restoredTables.length &&
        sourceTables.every((table, index) => table === restoredTables[index]);
      const recordCountsMatch =
        sourceTables.length === Object.keys(sourceCounts).length &&
        restoredTables.length === Object.keys(restoredCounts).length &&
        sourceTables.every(
          (table) => sourceCounts[table] === restoredCounts[table],
        );
      if (!schemaMatches || !recordCountsMatch) {
        throw new Error(
          "Temporary restore database did not match the source schema and record counts.",
        );
      }
      verification = {
        temporaryDatabaseHash: createHash("sha256")
          .update(temporaryDatabase, "utf8")
          .digest("hex"),
        recordCountComparison: {
          source: sourceCounts,
          restored: restoredCounts,
          matches: true,
        },
        schemaComparison: {
          sourceTableCount: sourceTables.length,
          restoredTableCount: restoredTables.length,
          matches: true,
        },
      };
    } catch (error) {
      failure = error;
    }

    if (created) {
      try {
        assertTemporaryDatabaseName(temporaryDatabase);
        await this.expectSuccess(command("dropdb", [
          ...connectionArgs(connection),
          "--maintenance-db", "postgres",
          "--if-exists",
          "--force",
          temporaryDatabase,
        ], connection, 60 * 1000));
      } catch (cleanupError) {
        failure ??= cleanupError;
      }
    }
    if (failure) throw failure;
    if (!verification) {
      throw new Error("Temporary restore verification did not complete.");
    }
    return verification;
  }

  async restorePlainAndVerifyInTemporaryDatabase(
    databaseUrl: string,
    sqlPath: string,
    expectedRecordCounts?: Record<string, number>,
  ): Promise<RestoreVerificationResult> {
    const connection = parsePostgreSqlConnection(databaseUrl);
    const temporaryDatabase = `avs_backup_verify_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
    assertTemporaryDatabaseName(temporaryDatabase);
    if (temporaryDatabase === connection.database) {
      throw new Error(
        "Temporary restore database cannot be the configured application database.",
      );
    }

    let created = false;
    let failure: unknown;
    let verification: RestoreVerificationResult | undefined;
    try {
      const sourceCounts =
        expectedRecordCounts ?? (await this.tableRecordCounts(databaseUrl));
      const sourceTables = Object.keys(sourceCounts).sort();
      await this.expectSuccess(
        command(
          "createdb",
          [
            ...connectionArgs(connection),
            "--maintenance-db",
            "postgres",
            temporaryDatabase,
          ],
          connection,
          60 * 1000,
        ),
      );
      created = true;
      await this.expectSuccess(
        command(
          "psql",
          [
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=on",
            "--single-transaction",
            ...connectionArgs(connection),
            "--dbname",
            temporaryDatabase,
            "--file",
            sqlPath,
          ],
          connection,
          30 * 60 * 1000,
        ),
      );
      const restoredTables = (
        await this.queryLines(
          connection,
          temporaryDatabase,
          TABLE_INVENTORY_SQL,
        )
      ).sort();
      const restoredCounts = await this.queryCounts(
        connection,
        temporaryDatabase,
        restoredTables,
      );
      const schemaMatches =
        sourceTables.length === restoredTables.length &&
        sourceTables.every((table, index) => table === restoredTables[index]);
      const recordCountsMatch =
        sourceTables.length === Object.keys(sourceCounts).length &&
        restoredTables.length === Object.keys(restoredCounts).length &&
        sourceTables.every(
          (table) => sourceCounts[table] === restoredCounts[table],
        );
      if (!schemaMatches || !recordCountsMatch) {
        throw new Error(
          "Temporary restore database did not match the source schema and record counts.",
        );
      }
      verification = {
        temporaryDatabaseHash: createHash("sha256")
          .update(temporaryDatabase, "utf8")
          .digest("hex"),
        recordCountComparison: {
          source: sourceCounts,
          restored: restoredCounts,
          matches: true,
        },
        schemaComparison: {
          sourceTableCount: sourceTables.length,
          restoredTableCount: restoredTables.length,
          matches: true,
        },
      };
    } catch (error) {
      failure = error;
    }

    if (created) {
      try {
        assertTemporaryDatabaseName(temporaryDatabase);
        await this.expectSuccess(
          command(
            "dropdb",
            [
              ...connectionArgs(connection),
              "--maintenance-db",
              "postgres",
              "--if-exists",
              "--force",
              temporaryDatabase,
            ],
            connection,
            60 * 1000,
          ),
        );
      } catch (cleanupError) {
        failure ??= cleanupError;
      }
    }
    if (failure) throw failure;
    if (!verification) {
      throw new Error("Temporary restore verification did not complete.");
    }
    return verification;
  }

  private async queryLines(
    connection: PostgreSqlConnection,
    database: string,
    sql: string,
  ): Promise<string[]> {
    const result = await this.executor.run(
      command(
        "psql",
        [
          "--no-psqlrc",
          "--tuples-only",
          "--no-align",
          ...connectionArgs(connection),
          "--dbname",
          database,
          "--command",
          sql,
        ],
        connection,
        60 * 1000,
      ),
    );
    if (result.exitCode !== 0) {
      throw new Error("psql failed while verifying the restored database.");
    }
    return result.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private async queryCounts(
    connection: PostgreSqlConnection,
    database: string,
    tables: string[],
  ): Promise<Record<string, number>> {
    const lines = await this.queryLines(
      connection,
      database,
      recordCountsSql(tables),
    );
    if (lines.length !== 1) {
      throw new Error("Database record-count verification returned invalid data.");
    }
    let value: unknown;
    try {
      value = JSON.parse(lines[0] ?? "");
    } catch {
      throw new Error("Database record-count verification returned invalid data.");
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== tables.length ||
      tables.some((table) => {
        const count = (value as Record<string, unknown>)[table];
        return (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        );
      })
    ) {
      throw new Error("Database record-count verification returned invalid data.");
    }
    return value as Record<string, number>;
  }

  private async expectSuccess(commandToRun: SafeCommand): Promise<void> {
    const result = await (this.executor as CommandExecutor).run(commandToRun);
    if (result.exitCode !== 0) {
      throw new Error(`${commandToRun.executable} failed with exit code ${result.exitCode}.`);
    }
  }
}
