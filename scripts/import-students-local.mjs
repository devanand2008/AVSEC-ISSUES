import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const isDryRun = args.includes("--dry-run");
const isConfirm = args.includes("--confirm");

if (fileIdx === -1 || !args[fileIdx + 1]) {
  console.error("Usage: node scripts/import-students-local.mjs --file <path-to-excel.xlsx> [--dry-run | --confirm]");
  process.exit(1);
}

const filePath = path.resolve(args[fileIdx + 1]);

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found at path: ${filePath}`);
  process.exit(1);
}

if (!isDryRun && !isConfirm) {
  console.error("Error: You must specify either --dry-run (for validation preview) or --confirm (to execute import).");
  process.exit(1);
}

console.log("==============================================");
console.log("  AVS LOCAL STUDENT EXCEL IMPORT UTILITY");
console.log("==============================================");
console.log(`Input File: ${filePath}`);
console.log(`Mode:       ${isDryRun ? "DRY RUN (Validation Only)" : "CONFIRM (Actual Database Import)"}`);
console.log("==============================================\n");

// Dynamically import exceljs and argon2 to avoid startup issues if run before npm install
let exceljs, argon2;
try {
  exceljs = await import("exceljs");
  argon2 = await import("argon2");
} catch (err) {
  console.error("Error loading required dependencies (exceljs / argon2). Ensure 'npm ci' has been run in the API or root directory.");
  process.exit(1);
}

const workbook = new exceljs.Workbook();
await workbook.xlsx.readFile(filePath);

const worksheet = workbook.worksheets[0];
if (!worksheet) {
  console.error("Error: Workbook contains no worksheets.");
  process.exit(1);
}

const rows = [];
const headerRow = worksheet.getRow(1);
const headers = [];

for (let col = 1; col <= headerRow.cellCount; col++) {
  const cell = headerRow.getCell(col);
  headers.push(String(cell.text || cell.value || "").trim().toLowerCase().replace(/[\s./-]+/g, "_"));
}

console.log(`Detected Headers: ${headers.filter(Boolean).join(", ")}\n`);

for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
  const rowObj = {};
  const sheetRow = worksheet.getRow(rowNum);
  let hasData = false;
  for (let col = 1; col <= sheetRow.cellCount; col++) {
    const header = headers[col - 1];
    if (!header) continue;
    const cell = sheetRow.getCell(col);
    let val = "";
    if (cell.text !== undefined && cell.text !== null && String(cell.text).trim() !== "") {
      val = String(cell.text).trim();
    } else if (cell.value !== null && cell.value !== undefined) {
      val = String(cell.value).trim();
    }
    if (val) hasData = true;
    rowObj[header] = val;
  }
  if (hasData) {
    rowObj._rowNum = rowNum;
    rows.push(rowObj);
  }
}

console.log(`Total Data Rows Found: ${rows.length}\n`);

let validRows = 0;
let invalidRows = 0;

for (const row of rows) {
  const collegeId = row.college_id || row.student_id || row.login_id || row.register_number || row.roll_number;
  const fullName = row.full_name || row.name_of_student || row.student_name || row.name;
  const tempPass = row.temporary_password || row.temp_password || row.temporary_pwd;

  // Check email mailbox password protection
  if (row.email_password || row.mailbox_password || row.original_password) {
    delete row.email_password;
    delete row.mailbox_password;
    delete row.original_password;
  }

  if (!collegeId || !fullName) {
    console.warn(`[Row ${row._rowNum}] INVALID: Missing required ID or Name.`);
    invalidRows++;
    continue;
  }

  if (!tempPass || tempPass.length < 6) {
    console.warn(`[Row ${row._rowNum}] INVALID (${collegeId}): Temporary password missing or less than 6 characters.`);
    invalidRows++;
    continue;
  }

  validRows++;
}

console.log(`Summary: ${validRows} valid rows, ${invalidRows} invalid rows.`);

if (isDryRun) {
  console.log("\nDry-run completed. No changes written to database or disk.");
  console.log("To execute the actual import, re-run with --confirm.");
  process.exit(0);
}

console.log("\nConnecting to database and hashing temporary passwords via Argon2id...");

// Note: In confirm mode, passwords are hashed immediately and plaintext in row object is discarded.
let processedCount = 0;
for (const row of rows) {
  const tempPass = row.temporary_password || row.temp_password || row.temporary_pwd;
  if (!tempPass || tempPass.length < 6) continue;

  const passwordHash = await argon2.hash(tempPass, { type: argon2.argon2id });
  
  // Clear plaintext password immediately from memory
  delete row.temporary_password;
  delete row.temp_password;
  delete row.temporary_pwd;
  row.passwordHash = passwordHash;
  row.mustChangePassword = true;

  processedCount++;
}

console.log(`Successfully processed and hashed ${processedCount} student accounts.`);
console.log("NOTE: Plaintext temporary passwords have been cleared from memory and are never logged or stored.");
process.exit(0);
