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
      });

      await expect(validate(input)).resolves.toEqual([]);
      expect(input.roomType).toBe(roomType);
    },
  );

  it.each([
    ["Staff Room", RoomType.STAFF_ROOM],
    ["staff-room", RoomType.STAFF_ROOM],
    ["Administrative Office", RoomType.ADMINISTRATIVE_OFFICE],
    ["parking area", RoomType.PARKING_AREA],
  ])("normalizes the readable label %s to %s", async (roomType, expected) => {
    const input = plainToInstance(UpdateRoomDto, { roomType });

    await expect(validate(input)).resolves.toEqual([]);
    expect(input.roomType).toBe(expected);
  });

  it("rejects unsupported room types", async () => {
    const input = plainToInstance(UpdateRoomDto, { roomType: "STORE_ROOM" });

    await expect(validate(input)).resolves.not.toEqual([]);
  });
});
