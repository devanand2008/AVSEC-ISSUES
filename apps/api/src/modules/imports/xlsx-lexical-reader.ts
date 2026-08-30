import { BadRequestException } from "@nestjs/common";
import { XMLParser } from "fast-xml-parser";
import { posix as path } from "node:path";
import type { Readable } from "node:stream";

interface ZipEntry {
  path: string;
  uncompressedSize?: number;
  stream(): Readable;
}

interface ZipDirectory {
  files: ZipEntry[];
}

interface UnzipperModule {
  Open: { buffer(value: Buffer): Promise<ZipDirectory> };
}

// unzipper does not publish TypeScript declarations; keep the untyped module
// behind the minimal interface used by this hardened reader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unzipper = require("unzipper") as UnzipperModule;

/**
 * XLSX expansion limits. These are intentionally above normal import
 * workbooks while bounding central-directory and decompression work.
 */
export const XLSX_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2_048,
  maxXmlEntryBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 75 * 1024 * 1024,
});

export type XlsxLexicalCellKind =
  | "NUMBER"
  | "SHARED_STRING"
  | "INLINE_STRING"
  | "STRING"
  | "BOOLEAN"
  | "ERROR"
  | "BLANK";

export interface XlsxLexicalCell {
  address: string;
  kind: XlsxLexicalCellKind;
  /** The exact lexical value stored in worksheet XML. Never parsed as a number. */
  rawValue: string;
  /** Resolved text for shared/inline string cells. */
  text: string;
  hasFormula: boolean;
}

export interface XlsxLexicalSheet {
  name: string;
  cells: ReadonlyMap<string, XlsxLexicalCell>;
}

type XmlNode = Record<string, unknown>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) =>
    ["sheet", "Relationship", "si", "row", "c", "r", "t"].includes(name),
});

function array(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown): XmlNode {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return scalar(value[0]);
  if (["string", "number", "boolean"].includes(typeof value))
    return String(value);
  const node = record(value);
  return scalar(node["#text"]);
}

function richText(value: unknown): string {
  const node = record(value);
  const direct = array(node.t).map(scalar).join("");
  if (direct) return direct;
  return array(node.r)
    .map((run) => array(record(run).t).map(scalar).join(""))
    .join("");
}

function safeArchivePath(value: string): string {
  const normalized = path.normalize(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /^[A-Za-z]:/.test(value) ||
    normalized.startsWith("../") ||
    path.isAbsolute(normalized)
  ) {
    throw new BadRequestException(
      "The XLSX workbook contains an unsafe archive path.",
    );
  }
  return normalized;
}

function relationshipTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed || trimmed.split(/[\\/]/).includes("..")) {
    throw new BadRequestException(
      "The XLSX workbook contains an unsafe sheet relationship.",
    );
  }
  const resolved = trimmed.startsWith("/")
    ? trimmed.slice(1)
    : path.join("xl", trimmed);
  if (!resolved.startsWith("xl/")) {
    throw new BadRequestException(
      "The XLSX workbook contains an unsafe sheet relationship.",
    );
  }
  return safeArchivePath(resolved);
}

function declaredUncompressedSize(entry: ZipEntry): number {
  const size = entry.uncompressedSize;
  if (!Number.isSafeInteger(size) || (size ?? -1) < 0) {
    throw new BadRequestException(
      "The XLSX workbook contains an invalid archive entry size.",
    );
  }
  return size as number;
}

async function readEntryBounded(
  entry: ZipEntry,
  maxBytes: number,
  limitMessage: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    const stream = entry.stream();
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? Buffer.from(value)
          : Buffer.from(value as Uint8Array);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        stream.destroy();
        throw new BadRequestException(limitMessage);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      "The XLSX workbook archive could not be read.",
    );
  }
  return Buffer.concat(chunks, bytes);
}

function cellKind(type: string): XlsxLexicalCellKind {
  switch (type) {
    case "s":
      return "SHARED_STRING";
    case "inlineStr":
      return "INLINE_STRING";
    case "str":
      return "STRING";
    case "b":
      return "BOOLEAN";
    case "e":
      return "ERROR";
    default:
      return "NUMBER";
  }
}

/**
 * Reads XLSX worksheet values directly from OOXML without routing numeric
 * password cells through JavaScript Number. The caller can therefore reject
 * decimals/scientific notation and preserve text-cell leading zeroes exactly.
 */
export async function readXlsxLexicalSheets(
  buffer: Buffer,
): Promise<ReadonlyMap<string, XlsxLexicalSheet>> {
  let directory: ZipDirectory;
  try {
    directory = await unzipper.Open.buffer(buffer);
  } catch {
    throw new BadRequestException(
      "The XLSX workbook archive could not be read.",
    );
  }

  if (directory.files.length > XLSX_ARCHIVE_LIMITS.maxEntries) {
    throw new BadRequestException(
      "The XLSX workbook contains too many archive entries.",
    );
  }
  const entries = new Map<string, ZipEntry>();
  const entrySizes = new Map<string, number>();
  const archivePaths = new Set<string>();
  let totalDeclaredBytes = 0;
  for (const entry of directory.files) {
    const entryPath = safeArchivePath(entry.path);
    if (archivePaths.has(entryPath)) {
      throw new BadRequestException(
        "The XLSX workbook contains duplicate archive parts.",
      );
    }
    archivePaths.add(entryPath);
    const size = declaredUncompressedSize(entry);
    if (
      size >
      XLSX_ARCHIVE_LIMITS.maxTotalUncompressedBytes - totalDeclaredBytes
    ) {
      throw new BadRequestException(
        "The XLSX workbook expands beyond the safe archive limit.",
      );
    }
    totalDeclaredBytes += size;
    if (!entryPath.endsWith(".xml") && !entryPath.endsWith(".rels")) continue;
    if (size > XLSX_ARCHIVE_LIMITS.maxXmlEntryBytes) {
      throw new BadRequestException(
        "The XLSX workbook contains an oversized XML part.",
      );
    }
    entries.set(entryPath, entry);
    entrySizes.set(entryPath, size);
  }

  const parsedEntries = new Map<string, XmlNode>();
  let adjustedTotalBytes = totalDeclaredBytes;
  const readXml = async (
    entryPath: string,
    required = true,
  ): Promise<XmlNode> => {
    const normalizedPath = safeArchivePath(entryPath);
    const cached = parsedEntries.get(normalizedPath);
    if (cached) return cached;
    const entry = entries.get(normalizedPath);
    if (!entry) {
      if (!required) return {};
      throw new BadRequestException(
        "The XLSX workbook is missing a required XML part.",
      );
    }
    const declaredSize = entrySizes.get(normalizedPath) ?? 0;
    const otherEntryBytes = adjustedTotalBytes - declaredSize;
    const remainingTotalBytes =
      XLSX_ARCHIVE_LIMITS.maxTotalUncompressedBytes - otherEntryBytes;
    const readLimit = Math.min(
      XLSX_ARCHIVE_LIMITS.maxXmlEntryBytes,
      remainingTotalBytes,
    );
    const body = await readEntryBounded(
      entry,
      readLimit,
      readLimit < XLSX_ARCHIVE_LIMITS.maxXmlEntryBytes
        ? "The XLSX workbook expands beyond the safe archive limit."
        : "The XLSX workbook contains an oversized XML part.",
    );
    adjustedTotalBytes = otherEntryBytes + body.length;
    try {
      const parsed = record(xml.parse(body.toString("utf8")));
      parsedEntries.set(normalizedPath, parsed);
      return parsed;
    } catch {
      throw new BadRequestException(
        "The XLSX workbook contains malformed XML.",
      );
    }
  };

  const workbook = record((await readXml("xl/workbook.xml")).workbook);
  const relationships = record(
    (await readXml("xl/_rels/workbook.xml.rels")).Relationships,
  );
  const targets = new Map<string, string>();
  for (const item of array(relationships.Relationship)) {
    const relation = record(item);
    const id = scalar(relation.Id);
    if (!id) {
      throw new BadRequestException(
        "The XLSX workbook contains an invalid relationship identifier.",
      );
    }
    if (targets.has(id)) {
      throw new BadRequestException(
        "The XLSX workbook contains duplicate relationship identifiers.",
      );
    }
    targets.set(id, relationshipTarget(scalar(relation.Target)));
  }

  const sharedRoot = record((await readXml("xl/sharedStrings.xml", false)).sst);
  const sharedStrings = array(sharedRoot.si).map(richText);
  const result = new Map<string, XlsxLexicalSheet>();
  const sheetNames = new Set<string>();
  const sheets = record(workbook.sheets);
  for (const sheetValue of array(sheets.sheet)) {
    const sheet = record(sheetValue);
    const name = scalar(sheet.name);
    const relationshipId = scalar(sheet["r:id"]);
    const target = targets.get(relationshipId);
    if (!name || !target) {
      throw new BadRequestException(
        "The XLSX workbook contains an invalid sheet relationship.",
      );
    }
    const comparableName = name.normalize("NFC").toLocaleLowerCase("en-US");
    if (sheetNames.has(comparableName)) {
      throw new BadRequestException(
        "The XLSX workbook contains duplicate sheet display names.",
      );
    }
    sheetNames.add(comparableName);
    const worksheet = record((await readXml(target)).worksheet);
    const sheetData = record(worksheet.sheetData);
    const cells = new Map<string, XlsxLexicalCell>();
    for (const rowValue of array(sheetData.row)) {
      for (const cellValue of array(record(rowValue).c)) {
        const cell = record(cellValue);
        const address = scalar(cell.r).toUpperCase();
        if (!/^[A-Z]{1,3}[1-9]\d*$/.test(address)) continue;
        if (cells.has(address)) {
          throw new BadRequestException(
            "The XLSX workbook contains duplicate cell addresses.",
          );
        }
        const type = scalar(cell.t);
        const kind = cellKind(type);
        const rawValue = scalar(cell.v);
        const inline = richText(cell.is);
        const sharedIndex =
          kind === "SHARED_STRING" && /^\d+$/.test(rawValue)
            ? Number(rawValue)
            : -1;
        const text =
          kind === "SHARED_STRING"
            ? (sharedStrings[sharedIndex] ?? "")
            : kind === "INLINE_STRING"
              ? inline
              : rawValue;
        cells.set(address, {
          address,
          kind: rawValue || inline ? kind : "BLANK",
          rawValue,
          text,
          hasFormula: Object.prototype.hasOwnProperty.call(cell, "f"),
        });
      }
    }
    result.set(name, { name, cells });
  }
  return result;
}
