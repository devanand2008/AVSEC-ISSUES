import { ValidationPipe } from "@nestjs/common";
import { UpdateSettingDto } from "../src/modules/admin/dto/admin.dto";

describe("admin setting validation", () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it("accepts a JSON setting value while retaining strict unknown-field rejection", async () => {
    await expect(
      pipe.transform(
        {
          value: {
            AIDS: "AI & DS",
            AIML: "AI & ML",
          },
        },
        { type: "body", metatype: UpdateSettingDto },
      ),
    ).resolves.toEqual({
      value: {
        AIDS: "AI & DS",
        AIML: "AI & ML",
      },
    });

    await expect(
      pipe.transform(
        { value: {}, unexpected: true },
        { type: "body", metatype: UpdateSettingDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform({}, { type: "body", metatype: UpdateSettingDto }),
    ).rejects.toThrow();
  });
});
