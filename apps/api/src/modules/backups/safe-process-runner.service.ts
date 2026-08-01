import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import type { CommandExecutor, CommandResult, SafeCommand } from "./backup.types";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const ALLOWED_EXECUTABLES = new Set(["pg_dump", "pg_restore", "createdb", "dropdb", "psql"]);

function appendBounded(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) return current;
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString("utf8");
}

@Injectable()
export class SafeProcessRunner implements CommandExecutor {
  run(command: SafeCommand): Promise<CommandResult> {
    if (!ALLOWED_EXECUTABLES.has(command.executable)) {
      return Promise.reject(new Error("Backup subprocess executable is not allowed."));
    }
    if (command.args.some((argument) => argument.includes("\0"))) {
      return Promise.reject(new Error("Backup subprocess argument is invalid."));
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command.executable, command.args, {
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...command.environment },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, command.timeoutMs);
      timeout.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk);
      });
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Could not start ${command.executable}.`));
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`${command.executable} exceeded its execution deadline.`));
          return;
        }
        resolve({ exitCode: exitCode ?? -1, stdout, stderr });
      });
    });
  }
}
