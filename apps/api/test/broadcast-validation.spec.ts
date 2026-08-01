import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateBroadcastDto } from "../src/modules/conversations/dto/broadcast.dto";

describe("broadcast validation", () => {
  it("accepts a title and the complete broadcast payload", async () => {
    const dto = plainToInstance(CreateBroadcastDto, {
      title: "  Campus closure  ",
      body: "The campus will be closed tomorrow.",
      audienceType: "ALL",
    });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto.title).toBe("Campus closure");
  });

  it("rejects unknown payload properties", async () => {
    const dto = plainToInstance(CreateBroadcastDto, {
      title: "Campus closure",
      body: "The campus will be closed tomorrow.",
      audienceType: "ALL",
      unexpected: true,
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === "unexpected")).toBe(true);
  });
});
