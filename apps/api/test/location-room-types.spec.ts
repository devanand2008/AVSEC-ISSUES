import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RoomType } from "../src/generated/prisma/enums";
import {
  CreateRoomDto,
  UpdateRoomDto,
} from "../src/modules/locations/dto/location.dto";

const floorId = "11111111-1111-4111-8111-111111111111";

describe("room type DTO validation", () => {
  it.each(Object.values(RoomType))(
    "accepts %s when creating a room",
    async (roomType) => {
      const input = plainToInstance(CreateRoomDto, {
        floorId,
        code: `ROOM-${roomType}`,
        name: roomType.replaceAll("_", " "),
        roomType,
        ...(roomType === RoomType.OTHER
          ? { customRoomTypeLabel: "Innovation Studio" }
          : {}),
      });

      await expect(validate(input)).resolves.toEqual([]);
      expect(input.roomType).toBe(roomType);
    },
  );

  it.each([
    ["Staff Room", RoomType.STAFF_ROOM],
    ["staff-room", RoomType.STAFF_ROOM],
    ["Faculty Room", RoomType.FACULTY_ROOM],
    ["office", RoomType.OFFICE],
    ["Store Room", RoomType.STORE_ROOM],
    ["Administrative Office", RoomType.ADMINISTRATIVE_OFFICE],
    ["parking area", RoomType.PARKING_AREA],
  ])("normalizes the readable label %s to %s", async (roomType, expected) => {
    const input = plainToInstance(UpdateRoomDto, { roomType });

    await expect(validate(input)).resolves.toEqual([]);
    expect(input.roomType).toBe(expected);
  });

  it("rejects unsupported room types", async () => {
    const input = plainToInstance(UpdateRoomDto, { roomType: "SERVER_VAULT" });

    await expect(validate(input)).resolves.not.toEqual([]);
  });

  it("requires and trims a 2-80 character custom label for OTHER rooms", async () => {
    const missing = plainToInstance(CreateRoomDto, {
      floorId,
      code: "OTHER-1",
      name: "Other Room",
      roomType: RoomType.OTHER,
    });
    const tooShort = plainToInstance(CreateRoomDto, {
      floorId,
      code: "OTHER-2",
      name: "Other Room",
      roomType: RoomType.OTHER,
      customRoomTypeLabel: " x ",
    });
    const valid = plainToInstance(CreateRoomDto, {
      floorId,
      code: "OTHER-3",
      name: "Innovation Studio",
      roomType: RoomType.OTHER,
      customRoomTypeLabel: "  Innovation Studio  ",
    });

    await expect(validate(missing)).resolves.not.toEqual([]);
    await expect(validate(tooShort)).resolves.not.toEqual([]);
    await expect(validate(valid)).resolves.toEqual([]);
    expect(valid.customRoomTypeLabel).toBe("Innovation Studio");
  });
});
