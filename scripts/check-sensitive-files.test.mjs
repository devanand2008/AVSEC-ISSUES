import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scannerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-sensitive-files.mjs",
);

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function createRepository(t, files) {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "avs-sensitive-files-test-"),
  );
  t.after(() => fs.rmSync(repository, { force: true, recursive: true }));

  const init = run("git", ["init", "--quiet"], repository);
  assert.equal(init.status, 0, init.stderr);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repository, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }

  const stage = run("git", ["add", "--force", "--", "."], repository);
  assert.equal(stage.status, 0, stage.stderr);
  return repository;
}

function scan(repository) {
  return run(process.execPath, [scannerPath], repository);
}

test("allows source files for the tracked Next.js admin exports route", (t) => {
  const repository = createRepository(t, {
    "apps/web/src/app/(portal)/admin/exports/page.test.ts":
      "export const route = '/admin/exports';\n",
    "apps/web/src/app/(portal)/admin/exports/page.tsx":
      "export default function ExportsPage() { return null; }\n",
  });

  const result = scan(repository);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Security preflight passed\./);
});

test("still rejects generated files in the repository-root exports directory", (t) => {
  const repository = createRepository(t, {
    "exports/users.json": "[]\n",
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exports\/users\.json/);
});

test("still rejects credential export directories at any depth", (t) => {
  const repository = createRepository(t, {
    "artifacts/credential-exports/users.json": "[]\n",
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifacts\/credential-exports\/users\.json/);
});

test("still rejects generated data inside the Next.js route directory", (t) => {
  const repository = createRepository(t, {
    "apps/web/src/app/(portal)/admin/exports/users.csv": "student_id\nAVS001\n",
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /admin\/exports\/users\.csv/);
});

test("still scans an allowed route source file for embedded secrets", (t) => {
  const syntheticKey = ["sk", "proj", "123456789012345678901234"].join("-");
  const repository = createRepository(t, {
    "apps/web/src/app/(portal)/admin/exports/page.tsx": `export const apiKey = '${syntheticKey}';\n`,
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /page\.tsx \(contains embedded secret/);
});

test("rejects embedded Gemini API key assignments", (t) => {
  const assignment = [
    "export const GEMINI_API",
    "_KEY = '",
    "not-a-real-but-secret-shaped-gemini-key",
    "';\n",
  ].join("");
  const repository = createRepository(t, {
    "config/provider.ts": assignment,
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /config\/provider\.ts \(contains embedded secret/,
  );
});

test("scans test files and the allowed environment example for real key shapes", (t) => {
  const openAiShape = ["sk", "proj", "abcdefghijklmnopqrstuvwx"].join("-");
  const googleShape = ["AIza", "abcdefghijklmnopqrstuvwxyz123456"].join("");
  const repository = createRepository(t, {
    ".env.example": `OPENAI_API_KEY=${openAiShape}\n`,
    "apps/api/test/provider.spec.ts": `const key = '${googleShape}';\n`,
  });

  const result = scan(repository);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.env\.example \(contains embedded secret/);
  assert.match(result.stderr, /provider\.spec\.ts \(contains embedded secret/);
});
