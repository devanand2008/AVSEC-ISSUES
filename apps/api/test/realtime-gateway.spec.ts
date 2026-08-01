import { RealtimeGateway } from "../src/modules/conversations/realtime.gateway";

describe("RealtimeGateway typing authorization", () => {
  const userId = "00000000-0000-0000-0000-000000000001";
  const conversationId = "00000000-0000-0000-0000-000000000002";

  function setup(participant: { id: string } | null) {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const client = { data: { userId }, to };
    const prisma = { conversationParticipant: { findFirst: jest.fn().mockResolvedValue(participant) } };
    const gateway = new RealtimeGateway({} as never, {} as never, prisma as never);
    return { gateway, prisma, client, emit, to };
  }

  it("rejects typing events from users without active participation", async () => {
    const { gateway, prisma, client, to } = setup(null);

    await expect(gateway.typing(client as never, { conversationId, typing: true })).resolves.toEqual({ accepted: false });
    expect(prisma.conversationParticipant.findFirst).toHaveBeenCalledWith({
      where: { conversationId, userId, leftAt: null },
      select: { id: true },
    });
    expect(to).not.toHaveBeenCalled();
  });

  it("broadcasts typing events for active participants", async () => {
    const { gateway, client, emit, to } = setup({ id: "00000000-0000-0000-0000-000000000003" });

    await expect(gateway.typing(client as never, { conversationId, typing: true })).resolves.toEqual({ accepted: true });
    expect(to).toHaveBeenCalledWith(`conversation:${conversationId}`);
    expect(emit).toHaveBeenCalledWith("typing.changed", { conversationId, userId, typing: true });
  });

  it("serializes attachment sizes before broadcasting a message", () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = new RealtimeGateway({} as never, {} as never, {} as never);
    gateway.server = { to } as never;

    gateway.messageCreated(conversationId, {
      id: "00000000-0000-0000-0000-000000000003",
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      attachments: [{ sizeBytes: BigInt(192) }],
    });

    expect(to).toHaveBeenCalledWith(`conversation:${conversationId}`);
    expect(emit).toHaveBeenCalledWith("message.created", {
      id: "00000000-0000-0000-0000-000000000003",
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      attachments: [{ sizeBytes: "192" }],
    });
  });
});
