import { BadRequestException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { ConversationsService } from "../src/modules/conversations/conversations.service";

describe("ConversationsService atomic attachment delivery", () => {
  const user: AuthPrincipal = {
    id: "00000000-0000-0000-0000-000000000001",
    publicId: "00000000-0000-0000-0000-000000000002",
    collegeId: "00000000-0000-0000-0000-000000000003",
    fullName: "AVS Student",
    email: "student@avsenggcollege.ac.in",
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-0000-0000-000000000004",
    roles: ["STUDENT"],
    permissions: ["messages.send"],
    scopes: [],
  };
  const conversationId = "00000000-0000-0000-0000-000000000005";
  const uploadId = "00000000-0000-0000-0000-000000000006";

  function harness(readyUploads: unknown[]) {
    const created = {
      id: "00000000-0000-0000-0000-000000000007",
      conversationId,
      body: "Atomic message",
    };
    const tx = {
      conversationParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "00000000-0000-0000-0000-000000000008" },
        ]),
      },
      messageAttachmentUpload: {
        findMany: jest.fn().mockResolvedValue(readyUploads),
        updateMany: jest.fn().mockResolvedValue({ count: readyUploads.length }),
      },
      message: { create: jest.fn().mockResolvedValue(created) },
      conversation: { update: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
    let committed = false;
    const prisma = {
      conversationParticipant: {
        findFirst: jest.fn().mockResolvedValue({ role: "MEMBER" }),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          sendRestricted: false,
          archivedAt: null,
        }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
    };
    const realtime = {
      messageCreated: jest.fn().mockImplementation(() => {
        expect(committed).toBe(true);
      }),
    };
    return {
      service: new ConversationsService(
        prisma as never,
        realtime as never,
        {} as never,
        {} as never,
      ),
      tx,
      realtime,
    };
  }

  it("does not create or broadcast a message when an upload is not READY", async () => {
    const { service, tx, realtime } = harness([]);

    await expect(
      service.send(user, conversationId, {
        body: "Atomic message",
        attachmentUploadIds: [uploadId],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.message.create).not.toHaveBeenCalled();
    expect(realtime.messageCreated).not.toHaveBeenCalled();
  });

  it("consumes a verified upload and broadcasts only after commit", async () => {
    const { service, tx, realtime } = harness([
      {
        id: uploadId,
        storageKey: "colleges/c/messages/pending/file.pdf",
        originalName: "notes.pdf",
        safeName: "safe.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(120),
        sha256: "a".repeat(64),
        thumbnailKey: null,
        width: null,
        height: null,
      },
    ]);

    const message = await service.send(user, conversationId, {
      body: "Atomic message",
      attachmentUploadIds: [uploadId],
    });

    expect(message.id).toBe("00000000-0000-0000-0000-000000000007");
    expect(tx.messageAttachmentUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONSUMED",
          consumedByMessageId: message.id,
        }),
      }),
    );
    expect(realtime.messageCreated).toHaveBeenCalledWith(
      conversationId,
      message,
    );
  });
});
