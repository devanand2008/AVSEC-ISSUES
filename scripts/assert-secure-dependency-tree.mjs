import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED = Object.freeze({
  swagger: "11.4.6",
  swaggerJsYaml: "5.2.3",
  allowedJsYaml: Object.freeze(["3.15.1", "4.3.1", "5.2.3"]),
  nanoid: "3.3.18",
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const failures = [];

function readJson(relativePath, label) {
  const absolutePath = path.join(rootDirectory, ...relativePath.split("/"));
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    failures.push(`${label} could not be read: ${error.message}`);
    return {};
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    failures.push(
      `${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`,
    );
  }
}

function isLockEntryForPackage(lockPath, packageName) {
  const suffix = `node_modules/${packageName}`;
  return lockPath === suffix || lockPath.endsWith(`/${suffix}`);
}

function matchingLockEntries(lockPackages, packageName) {
  return Object.entries(lockPackages).filter(([lockPath]) =>
    isLockEntryForPackage(lockPath, packageName),
  );
}

function verifyInstalledLockEntry(lockPath, packageName, expectedVersion) {
  const manifest = readJson(
    `${lockPath}/package.json`,
    `installed ${packageName} manifest`,
  );
  expectEqual(manifest.name, packageName, `installed package at ${lockPath}`);
  expectEqual(
    manifest.version,
    expectedVersion,
    `installed ${packageName} at ${lockPath}`,
  );
}

const rootManifest = readJson("package.json", "root package manifest");
const apiManifest = readJson("apps/api/package.json", "API package manifest");
const packageLock = readJson("package-lock.json", "package lock");
const lockPackages = packageLock.packages ?? {};

expectEqual(
  rootManifest.dependencies?.["@nestjs/swagger"],
  EXPECTED.swagger,
  "root @nestjs/swagger dependency",
);
expectEqual(
  apiManifest.dependencies?.["@nestjs/swagger"],
  EXPECTED.swagger,
  "API @nestjs/swagger dependency",
);
expectEqual(
  rootManifest.overrides?.["@nestjs/swagger"]?.["js-yaml"],
  EXPECTED.swaggerJsYaml,
  "@nestjs/swagger js-yaml override",
);
expectEqual(rootManifest.overrides?.nanoid, EXPECTED.nanoid, "nanoid override");

expectEqual(
  lockPackages[""]?.dependencies?.["@nestjs/swagger"],
  EXPECTED.swagger,
  "locked root @nestjs/swagger dependency",
);
expectEqual(
  lockPackages["apps/api"]?.dependencies?.["@nestjs/swagger"],
  EXPECTED.swagger,
  "locked API @nestjs/swagger dependency",
);

const swaggerEntries = matchingLockEntries(lockPackages, "@nestjs/swagger");
if (swaggerEntries.length === 0) {
  failures.push("package lock does not contain @nestjs/swagger");
}
for (const [lockPath, metadata] of swaggerEntries) {
  expectEqual(
    metadata.version,
    EXPECTED.swagger,
    `locked @nestjs/swagger at ${lockPath}`,
  );
  verifyInstalledLockEntry(lockPath, "@nestjs/swagger", EXPECTED.swagger);
}

const swaggerJsYamlPath = "node_modules/@nestjs/swagger/node_modules/js-yaml";
expectEqual(
  lockPackages[swaggerJsYamlPath]?.version,
  EXPECTED.swaggerJsYaml,
  "locked js-yaml resolved for @nestjs/swagger",
);

const jsYamlEntries = matchingLockEntries(lockPackages, "js-yaml");
if (jsYamlEntries.length === 0) {
  failures.push("package lock does not contain js-yaml");
}
for (const [lockPath, metadata] of jsYamlEntries) {
  if (!EXPECTED.allowedJsYaml.includes(metadata.version)) {
    failures.push(
      `locked js-yaml at ${lockPath} must be one of ${EXPECTED.allowedJsYaml.join(", ")}; found ${JSON.stringify(metadata.version)}`,
    );
  }
  verifyInstalledLockEntry(lockPath, "js-yaml", metadata.version);
}

const nanoidEntries = matchingLockEntries(lockPackages, "nanoid");
if (nanoidEntries.length === 0) {
  failures.push("package lock does not contain nanoid");
}
for (const [lockPath, metadata] of nanoidEntries) {
  expectEqual(
    metadata.version,
    EXPECTED.nanoid,
    `locked nanoid at ${lockPath}`,
  );
  verifyInstalledLockEntry(lockPath, "nanoid", EXPECTED.nanoid);
}

if (failures.length > 0) {
  console.error("Secure dependency tree validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Secure dependency tree validation passed.");
console.log(
  `@nestjs/swagger ${EXPECTED.swagger} -> js-yaml ${EXPECTED.swaggerJsYaml}; allowed js-yaml ${EXPECTED.allowedJsYaml.join(", ")}; nanoid ${EXPECTED.nanoid}.`,
);
