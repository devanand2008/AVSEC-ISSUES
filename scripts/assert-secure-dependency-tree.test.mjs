import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const validatorSource = path.join(
  sourceDirectory,
  "assert-secure-dependency-tree.mjs",
);

function writeJson(rootDirectory, relativePath, value) {
  const absolutePath = path.join(rootDirectory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(t) {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "avs-dependency-policy-"),
  );
  t.after(() => fs.rmSync(rootDirectory, { force: true, recursive: true }));

  const rootManifest = {
    dependencies: { "@nestjs/swagger": "11.4.6" },
    overrides: {
      "@nestjs/swagger": { "js-yaml": "5.2.3" },
      nanoid: "3.3.17",
    },
  };
  const apiManifest = { dependencies: { "@nestjs/swagger": "11.4.6" } };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@nestjs/swagger": "11.4.6" } },
      "apps/api": { dependencies: { "@nestjs/swagger": "11.4.6" } },
      "node_modules/@nestjs/swagger": { version: "11.4.6" },
      "node_modules/@nestjs/swagger/node_modules/js-yaml": { version: "5.2.3" },
      "node_modules/js-yaml": { version: "4.3.1" },
      "node_modules/nanoid": { version: "3.3.17" },
    },
  };

  writeJson(rootDirectory, "package.json", rootManifest);
  writeJson(rootDirectory, "apps/api/package.json", apiManifest);
  writeJson(rootDirectory, "package-lock.json", lock);
  writeJson(rootDirectory, "node_modules/@nestjs/swagger/package.json", {
    name: "@nestjs/swagger",
    version: "11.4.6",
  });
  writeJson(
    rootDirectory,
    "node_modules/@nestjs/swagger/node_modules/js-yaml/package.json",
    {
      name: "js-yaml",
      version: "5.2.3",
    },
  );
  writeJson(rootDirectory, "node_modules/js-yaml/package.json", {
    name: "js-yaml",
    version: "4.3.1",
  });
  writeJson(rootDirectory, "node_modules/nanoid/package.json", {
    name: "nanoid",
    version: "3.3.17",
  });
  fs.mkdirSync(path.join(rootDirectory, "scripts"), { recursive: true });
  fs.copyFileSync(
    validatorSource,
    path.join(rootDirectory, "scripts", path.basename(validatorSource)),
  );

  return { lock, rootDirectory };
}

function runValidator(rootDirectory) {
  return spawnSync(
    process.execPath,
    ["scripts/assert-secure-dependency-tree.mjs"],
    {
      cwd: rootDirectory,
      encoding: "utf8",
    },
  );
}

test("accepts the pinned secure dependency tree", (t) => {
  const { rootDirectory } = createFixture(t);
  const result = runValidator(rootDirectory);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Secure dependency tree validation passed/);
});

test("rejects a disallowed js-yaml version anywhere in the lock and install", (t) => {
  const { lock, rootDirectory } = createFixture(t);
  lock.packages["node_modules/js-yaml"].version = "4.3.0";
  writeJson(rootDirectory, "package-lock.json", lock);
  writeJson(rootDirectory, "node_modules/js-yaml/package.json", {
    name: "js-yaml",
    version: "4.3.0",
  });

  const result = runValidator(rootDirectory);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be one of 3\.15\.1, 4\.3\.1, 5\.2\.3/);
});

test("rejects an installed nanoid downgrade even when the lock remains pinned", (t) => {
  const { rootDirectory } = createFixture(t);
  writeJson(rootDirectory, "node_modules/nanoid/package.json", {
    name: "nanoid",
    version: "3.3.8",
  });

  const result = runValidator(rootDirectory);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /installed nanoid at node_modules\/nanoid must be "3\.3\.17"/,
  );
});

test("rejects a downgraded js-yaml resolution under Swagger", (t) => {
  const { lock, rootDirectory } = createFixture(t);
  lock.packages["node_modules/@nestjs/swagger/node_modules/js-yaml"].version =
    "5.2.1";
  writeJson(rootDirectory, "package-lock.json", lock);
  writeJson(
    rootDirectory,
    "node_modules/@nestjs/swagger/node_modules/js-yaml/package.json",
    {
      name: "js-yaml",
      version: "5.2.1",
    },
  );

  const result = runValidator(rootDirectory);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /locked js-yaml resolved for @nestjs\/swagger must be "5\.2\.3"/,
  );
});
