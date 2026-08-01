import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { FinishIssueDto, IssueTimelineDto } from "../src/modules/issues/dto/issue.dto";

describe("maintenance workflow validation", () => {
  it("accepts a complete repair timeline", async () => {
    const dto = plainToInstance(IssueTimelineDto, {
      expectedCompletionAt: "2026-07-29T10:30:00.000Z",
      reason: "Replacement motor must be purchased.",
      progressNote: "Supplier contacted.",
      requiredParts: "Motor",
      requiredApproval: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("rejects a finish request without a completion photo id", async () => {
    const dto = plainToInstance(FinishIssueDto, {
      resolutionNote: "Motor replaced and tested.",
      completedAt: "2026-07-27T12:00:00.000Z",
    });
    expect((await validate(dto)).some(({ property }) => property === "completionPhotoFileId")).toBe(true);
  });

  it("accepts a finish request with evidence and resolution metadata", async () => {
    const dto = plainToInstance(FinishIssueDto, {
      resolutionNote: "Motor replaced and tested.",
      completionPhotoFileId: "61d2a8de-aef2-4dd8-b764-55fce62c1358",
      completedAt: "2026-07-27T12:00:00.000Z",
      partsUsed: "Replacement motor",
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
