import { BadRequestException } from "@nestjs/common";
import { Workbook } from "exceljs";
import JSZip from "jszip";
import {
  readXlsxLexicalSheets,
  XLSX_ARCHIVE_LIMITS,
} from "../src/modules/imports/xlsx-lexical-reader";

async function workbookBuffer(sheetNames = ["Credentials"]): Promise<Buffer> {
  const workbook = new Workbook();
  for (const name of sheetNames) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRows([["PASSWORD"], ["value"]]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function rewritePart(
  archive: Buffer,
  partName: string,
  rewrite: (value: string) => string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(archive);
  const part = zip.file(partName);
  if (!part) throw new Error(`Missing test fixture part: ${partName}`);
  zip.file(partName, rewrite(await part.async("string")));
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

function rewriteDeclaredSize(
  archive: Buffer,
  entryName: string,
  uncompressedSize: number,
): Buffer {
  const result = Buffer.from(archive);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let searchFrom = 0;
  while (searchFrom < result.length) {
    const offset = result.indexOf(signature, searchFrom);
    if (offset < 0 || offset + 46 > result.length) break;
    const nameLength = result.readUInt16LE(offset + 28);
    const extraLength = result.readUInt16LE(offset + 30);
    const commentLength = result.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > result.length) break;
    if (result.subarray(nameStart, nameEnd).toString("utf8") === entryName) {
      result.writeUInt32LE(uncompressedSize, offset + 24);
      return result;
    }
    searchFrom = nameEnd + extraLength + commentLength;
  }
  throw new Error(`Missing central-directory test entry: ${entryName}`);
}

describe("readXlsxLexicalSheets", () => {
  it("publishes conservative expansion limits for archive validation", () => {
    expect(XLSX_ARCHIVE_LIMITS).toEqual({
      maxEntries: 2_048,
      maxXmlEntryBytes: 25 * 1024 * 1024,
      maxTotalUncompressedBytes: 75 * 1024 * 1024,
    });
  });

  it("keeps password XML lexemes separate from Excel display formatting", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Credentials");
    sheet.addRow(["PASSWORD"]);
    sheet.getCell("A2").value = 1234;
    sheet.getCell("A2").numFmt = "000000";
    sheet.getCell("A3").value = 123.125;
    sheet.getCell("A3").numFmt = "0";
    sheet.getCell("A4").value = "001234567890";

    const parsed = await readXlsxLexicalSheets(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    const cells = parsed.get("Credentials")?.cells;

    expect(cells?.get("A2")).toMatchObject({
      kind: "NUMBER",
      rawValue: "1234",
      text: "1234",
      hasFormula: false,
    });
    expect(cells?.get("A3")).toMatchObject({
      kind: "NUMBER",
      rawValue: "123.125",
    });
    expect(cells?.get("A4")).toMatchObject({
      kind: "SHARED_STRING",
      text: "001234567890",
    });
  });

  it("marks formulas without evaluating their cached results", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Credentials");
    sheet.addRow(["PASSWORD"]);
    sheet.getCell("A2").value = { formula: "1000+234", result: 1234 };

    const parsed = await readXlsxLexicalSheets(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(parsed.get("Credentials")?.cells.get("A2")?.hasFormula).toBe(true);
  });

  it.each(["../escape.xml", "/absolute.xml", "xl\\rogue.xml"])(
    "rejects unsafe archive path %s",
    async (unsafePath) => {
      const zip = await JSZip.loadAsync(await workbookBuffer());
      zip.file(unsafePath, "unsafe", { createFolders: false });
      const archive = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      );

      await expect(readXlsxLexicalSheets(archive)).rejects.toThrow(
        "unsafe archive path",
      );
    },
  );

  it("rejects excessive central-directory entry counts", async () => {
    const zip = await JSZip.loadAsync(await workbookBuffer());
    for (let index = 0; index <= XLSX_ARCHIVE_LIMITS.maxEntries; index += 1) {
      zip.file(`padding-${index}.bin`, "", { createFolders: false });
    }
    const archive = Buffer.from(
      await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
    );

    await expect(readXlsxLexicalSheets(archive)).rejects.toThrow(
      "too many archive entries",
    );
  }, 30_000);

  it("counts declared non-XML expansion toward the total archive limit", async () => {
    const zip = await JSZip.loadAsync(await workbookBuffer());
    const entryName = "xl/media/padding.bin";
    zip.file(entryName, "x");
    const archive = Buffer.from(
      await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
    );
    const forged = rewriteDeclaredSize(
      archive,
      entryName,
      XLSX_ARCHIVE_LIMITS.maxTotalUncompressedBytes + 1,
    );

    await expect(readXlsxLexicalSheets(forged)).rejects.toThrow(
      "safe archive limit",
    );
  });

  it("stops XML decompression when actual bytes exceed forged metadata", async () => {
    const zip = await JSZip.loadAsync(await workbookBuffer());
    const entryName = "xl/workbook.xml";
    zip.file(
      entryName,
      Buffer.alloc(XLSX_ARCHIVE_LIMITS.maxXmlEntryBytes + 1, 0x20),
    );
    const archive = Buffer.from(
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    const forged = rewriteDeclaredSize(archive, entryName, 1);

    await expect(readXlsxLexicalSheets(forged)).rejects.toThrow(
      "oversized XML part",
    );
  }, 60_000);

  it("rejects duplicate workbook relationship identifiers", async () => {
    const archive = await rewritePart(
      await workbookBuffer(),
      "xl/_rels/workbook.xml.rels",
      (value) => value.replace('Id="rId2"', 'Id="rId1"'),
    );

    await expect(readXlsxLexicalSheets(archive)).rejects.toThrow(
      "duplicate relationship identifiers",
    );
  });

  it("rejects duplicate sheet display names case-insensitively", async () => {
    const archive = await rewritePart(
      await workbookBuffer(["First", "Second"]),
      "xl/workbook.xml",
      (value) => value.replace('name="Second"', 'name="first"'),
    );

    await expect(readXlsxLexicalSheets(archive)).rejects.toThrow(
      "duplicate sheet display names",
    );
  });

  it("rejects duplicate normalized cell addresses", async () => {
    const archive = await rewritePart(
      await workbookBuffer(),
      "xl/worksheets/sheet1.xml",
      (value) => value.replace('r="A2"', 'r="a1"'),
    );

    await expect(readXlsxLexicalSheets(archive)).rejects.toThrow(
      "duplicate cell addresses",
    );
  });

  it("rejects malformed archives without leaking their content", async () => {
    await expect(
      readXlsxLexicalSheets(Buffer.from("not-an-xlsx")),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
