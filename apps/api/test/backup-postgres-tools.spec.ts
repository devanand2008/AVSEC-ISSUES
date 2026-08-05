import type { CommandExecutor, CommandResult, SafeCommand } from "../src/modules/backups/backup.types";
import { PostgresToolsService, parsePostgreSqlConnection } from "../src/modules/backups/postgres-tools.service";
import type { SafeProcessRunner } from "../src/modules/backups/safe-process-runner.service";

class MockExecutor implements CommandExecutor {
  readonly commands: SafeCommand[] = [];
  failExecutable?: SafeCommand["executable"];

  async run(command: SafeCommand): Promise<CommandResult> {
    this.commands.push(command);
    if (this.failExecutable === command.executable) {
      return { exitCode: 1, stdout: "", stderr: "deliberately omitted from application errors" };
    }
    if (command.executable === "psql") {
      const sql = command.args.at(-1) ?? "";
      return {
        exitCode: 0,
        stdout: sql.includes("json_build_object")
          ? '{"users":40,"migrations":39}\n'
          : "audit_logs\nusers\n",
        stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout: "catalog\n",
      stderr: "",
    };
  }
}

describe("PostgresToolsService command boundaries", () => {
  const databaseUrl = "postgresql://backup_user:s%40fe-secret@db.internal:5433/college_prod?sslmode=verify-full";

  it("parses PostgreSQL connection data without putting the password in command arguments", async () => {
    const executor = new MockExecutor();
    const service = new PostgresToolsService(executor as unknown as SafeProcessRunner);
    await service.dump(databaseUrl, "C:\\safe\\backup.dump");

    const dump = executor.commands[0];
    expect(dump?.executable).toBe("pg_dump");
    expect(dump?.args).toContain("college_prod");
    expect(dump?.args).not.toContain(databaseUrl);
    expect(dump?.args.join(" ")).not.toContain("s@fe-secret");
    expect(dump?.environment.PGPASSWORD).toBe("s@fe-secret");
    expect(dump?.environment.PGSSLMODE).toBe("verify-full");
  });

  it("restores only into an internally generated temporary database and always drops it", async () => {
    const executor = new MockExecutor();
    const service = new PostgresToolsService(executor as unknown as SafeProcessRunner);
    await expect(
      service.restoreAndVerifyInTemporaryDatabase(
        databaseUrl,
        "C:\\safe\\backup.dump",
      ),
    ).resolves.toMatchObject({
      recordCountComparison: { matches: true },
      schemaComparison: { matches: true, sourceTableCount: 2 },
    });

    expect(executor.commands.map(({ executable }) => executable)).toEqual([
      "psql",
      "psql",
      "createdb",
      "pg_restore",
      "psql",
      "psql",
      "dropdb",
    ]);
    const createdDatabase = executor.commands[2]?.args.at(-1);
    expect(createdDatabase).toMatch(/^avs_backup_verify_/);
    expect(createdDatabase).not.toBe("college_prod");
    expect(executor.commands[3]?.args).toContain(createdDatabase);
    expect(executor.commands[4]?.args).toContain(createdDatabase);
    expect(executor.commands[5]?.args).toContain(createdDatabase);
    expect(executor.commands[6]?.args.at(-1)).toBe(createdDatabase);
    expect(executor.commands.flatMap(({ args }) => args)).not.toContain("--clean");
  });

  it("creates readable full and schema SQL with the required safe pg_dump flags", async () => {
    const executor = new MockExecutor();
    const service = new PostgresToolsService(executor as unknown as SafeProcessRunner);
    await service.dumpPlain(databaseUrl, "C:\\safe\\avs_portal_full.sql");
    await service.dumpSchema(databaseUrl, "C:\\safe\\avs_portal_schema.sql");

    const [full, schema] = executor.commands;
    expect(full?.args).toEqual(expect.arrayContaining([
      "--format=plain",
      "--no-owner",
      "--no-privileges",
      "--clean",
      "--if-exists",
      "--encoding=UTF8",
    ]));
    expect(schema?.args).toEqual(expect.arrayContaining([
      "--schema-only",
      "--format=plain",
      "--no-owner",
      "--no-privileges",
    ]));
    expect(executor.commands.flatMap(({ args }) => args).join(" ")).not.toContain("s@fe-secret");
  });

  it("restores plain SQL with stop-on-error and a single transaction", async () => {
    const executor = new MockExecutor();
    const service = new PostgresToolsService(executor as unknown as SafeProcessRunner);
    await expect(
      service.restorePlainAndVerifyInTemporaryDatabase(
        databaseUrl,
        "C:\\safe\\avs_portal_full.sql",
      ),
    ).resolves.toMatchObject({
      recordCountComparison: { matches: true },
      schemaComparison: { matches: true },
    });
    const restore = executor.commands.find(
      (item) => item.executable === "psql" && item.args.includes("--file"),
    );
    expect(restore?.args).toEqual(expect.arrayContaining([
      "--set",
      "ON_ERROR_STOP=on",
      "--single-transaction",
      "--file",
      "C:\\safe\\avs_portal_full.sql",
    ]));
    const temporaryDatabase = restore?.args[restore.args.indexOf("--dbname") + 1];
    expect(temporaryDatabase).toMatch(/^avs_backup_verify_/);
    expect(executor.commands.at(-1)).toMatchObject({ executable: "dropdb" });
  });

  it("drops the temporary database after a mocked restore failure", async () => {
    const executor = new MockExecutor();
    executor.failExecutable = "pg_restore";
    const service = new PostgresToolsService(executor as unknown as SafeProcessRunner);

    await expect(service.restoreAndVerifyInTemporaryDatabase(databaseUrl, "C:\\safe\\backup.dump"))
      .rejects.toThrow("pg_restore failed with exit code 1");
    expect(executor.commands.map(({ executable }) => executable)).toEqual([
      "psql",
      "psql",
      "createdb",
      "pg_restore",
      "dropdb",
    ]);
  });

  it("rejects non-PostgreSQL and incomplete connection URLs", () => {
    expect(() => parsePostgreSqlConnection("mysql://user:secret@db/prod")).toThrow("PostgreSQL protocol");
    expect(() => parsePostgreSqlConnection("postgresql://db.internal/prod")).toThrow("host, username, and database");
  });
});
