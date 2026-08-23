import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { Readable } from "node:stream";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { ImportsController } from "../src/modules/imports/imports.controller";
import { ImportsFileService } from "../src/modules/imports/imports-file.service";

const COLLEGE_ID = "00000000-0000-4000-8000-000000000201";
const IMPORT_JOB_ID = "00000000-0000-4000-8000-000000000202";
const PEOPLE_KEY = `colleges/${COLLEGE_ID}/imports/source/${IMPORT_JOB_ID}.csv`;
const TEST_PEPPER = "test-only-people-source-pepper-32-bytes-minimum";

function sourceFile(content: Buffer, originalname = "people.csv") {
  return {
    buffer: content,
    originalname,
    mimetype: "text/csv",
    size: content.length,
  } as Express.Multer.File;
}

function serviceWithObjectStore(initialBody = Buffer.alloc(0)) {
  const service = new ImportsFileService(
    new ConfigService({
      S3_BUCKET: "private",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "test",
      S3_SECRET_KEY: "test-secret",
      S3_FORCE_PATH_STYLE: true,
      PASSWORD_PEPPER: TEST_PEPPER,
    }),
  );
  let storedBody = Buffer.from(initialBody);
  let lastPut: PutObjectCommand | undefined;
  const send = jest.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      lastPut = command;
      storedBody = Buffer.from(command.input.Body as Uint8Array);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      return { Body: Readable.from([storedBody]) };
    }
    throw new Error("Unexpected object-store command in test.");
  });
  (
    service as unknown as {
      client: { send: typeof send };
    }
  ).client.send = send;
  return {
    service,
    body: () => Buffer.from(storedBody),
    put: () => lastPut,
    replaceBody: (body: Buffer) => {
      storedBody = Buffer.from(body);
    },
  };
}

describe("People import source confidentiality", () => {
  it("stores an authenticated envelope without plaintext and decrypts it transparently", async () => {
    const password = "PrivatePeoplePassword@2026";
    const plaintext = Buffer.from(
      `User Name,User ID,User Password\nTest Student,AVS001,${password}\n`,
      "utf8",
    );
    const store = serviceWithObjectStore();

    await store.service.saveSource(
      COLLEGE_ID,
      "PEOPLE",
      sourceFile(plaintext),
      PEOPLE_KEY,
    );

    const encrypted = store.body();
    expect(encrypted.equals(plaintext)).toBe(false);
    expect(encrypted.includes(plaintext)).toBe(false);
    expect(encrypted.toString("utf8")).not.toContain(password);
    expect(store.put()?.input.Metadata).toMatchObject({
      entity: "PEOPLE",
      sourceEncryption: "aes-256-gcm-v1",
    });
    await expect(store.service.loadSource(PEOPLE_KEY)).resolves.toEqual(
      plaintext,
    );
  });

  it("rejects a tampered encrypted source", async () => {
    const store = serviceWithObjectStore();
    await store.service.saveSource(
      COLLEGE_ID,
      "PEOPLE",
      sourceFile(Buffer.from("User Password\nSecret@12345\n", "utf8")),
      PEOPLE_KEY,
    );
    const tampered = store.body();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    store.replaceBody(tampered);

    await expect(store.service.loadSource(PEOPLE_KEY)).rejects.toThrow(
      "Stored People import source failed authenticated decryption.",
    );
  });

  it("continues to read legacy plaintext sources", async () => {
    const plaintext = Buffer.from(
      "User Name,User ID,User Password\nLegacy,AVS002,Legacy@12345\n",
      "utf8",
    );
    const store = serviceWithObjectStore(plaintext);

    await expect(store.service.loadSource(PEOPLE_KEY)).resolves.toEqual(
      plaintext,
    );
  });

  it("keeps non-People source storage byte-compatible", async () => {
    const plaintext = Buffer.from("code,name\nA,Academic Block\n", "utf8");
    const key = `colleges/${COLLEGE_ID}/imports/source/${IMPORT_JOB_ID}.csv`;
    const store = serviceWithObjectStore();

    await store.service.saveSource(
      COLLEGE_ID,
      "BLOCKS",
      sourceFile(plaintext, "blocks.csv"),
      key,
    );

    expect(store.body()).toEqual(plaintext);
    expect(store.put()?.input.Metadata).toMatchObject({ entity: "BLOCKS" });
  });

  it("marks credential workbook responses private and non-cacheable", async () => {
    const imports = {
      credentials: jest.fn().mockResolvedValue({
        fileName: "credentials.xlsx",
        content: Buffer.from("workbook"),
        exportId: "11111111-1111-4111-8111-111111111111",
      }),
    };
    const controller = new ImportsController(imports as never);
    const response = { setHeader: jest.fn() } as unknown as Response;
    const user = {
      id: "00000000-0000-4000-8000-000000000203",
      collegeId: COLLEGE_ID,
      permissions: ["users.import"],
      roles: ["MAIN_ADMIN"],
    } as AuthPrincipal;

    await controller.credentials(
      user,
      IMPORT_JOB_ID,
      "request-id",
      "11111111-1111-4111-8111-111111111111",
      response,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store, max-age=0",
    );
    expect(response.setHeader).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(response.setHeader).toHaveBeenCalledWith("Expires", "0");
  });
});
