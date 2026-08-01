import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAnnouncementDto } from "../src/modules/announcements/dto/announcement.dto";

const validAudience = [{ scopeType: "COLLEGE" }];

async function titleErrors(title: string) {
  const dto = plainToInstance(CreateAnnouncementDto, {
    title,
    message: "A valid announcement message.",
    audiences: validAudience,
  });
  return validate(dto);
}

describe("announcement title validation", () => {
  it.each([
    "Exam Schedule",
    "தேர்வு அட்டவணை",
    "Internal Assessment – தமிழ் 2",
    "XY",
  ])("accepts a custom Unicode title: %s", async (title) => {
    expect(await titleErrors(title)).toHaveLength(0);
  });

  it("trims a valid title before validation", async () => {
    const dto = plainToInstance(CreateAnnouncementDto, {
      title: "  College Holiday  ",
      message: "A valid announcement message.",
      audiences: validAudience,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.title).toBe("College Holiday");
  });

  it.each(["", "   ", "X", "<script>alert(1)</script>"])(
    "rejects a blank, too-short, or markup title: %s",
    async (title) => {
      expect((await titleErrors(title)).length).toBeGreaterThan(0);
    },
  );

  it("accepts a 200-character title and rejects a 201-character title", async () => {
    expect(await titleErrors("அ".repeat(200))).toHaveLength(0);
    expect((await titleErrors("a".repeat(201))).length).toBeGreaterThan(0);
  });
});
