import { describe, expect, it } from "vitest";
import {
  buildPromotionPayload,
  nextStudyYear,
  promotionAfterSourceAcademicYearChange,
  promotionAfterSourceProgrammeChange,
  promotionAfterSourceStudyYearChange,
  promotionTargetSectionFilters,
  toggleSelectedStudent,
  validatePromotionDraft,
  type StudentPromotionDraft,
} from "./student-promotion";

const draft: StudentPromotionDraft = {
  sourceAcademicYearId: "year-current",
  sourceProgrammeId: "programme-cse",
  sourceStudyYear: "2",
  sourceSectionId: "source-a",
  studentPublicIds: ["student-1", "student-2"],
  targetAcademicYearId: "year-next",
  targetStudyYear: "3",
  targetSemesterId: "semester-5",
  targetSectionId: "target-a",
  completionStatus: "",
  academicOverride: false,
  academicOverrideReason: "",
};

describe("student promotion helpers", () => {
  it("moves each Engineering year forward and ends after fourth year", () => {
    expect([1, 2, 3, 4].map(nextStudyYear)).toEqual([2, 3, 4, null]);
  });

  it("builds a selected-student promotion payload", () => {
    expect(validatePromotionDraft(draft)).toBeNull();
    expect(buildPromotionPayload(draft)).toEqual({
      sourceSectionId: "source-a",
      studentPublicIds: ["student-1", "student-2"],
      targetAcademicYearId: "year-next",
      targetStudyYear: 3,
      targetSemesterId: "semester-5",
      targetSectionId: "target-a",
    });
  });

  it("supports fourth-year completion without a target placement", () => {
    expect(
      buildPromotionPayload({ ...draft, completionStatus: "GRADUATED" }),
    ).toEqual({
      sourceSectionId: "source-a",
      studentPublicIds: ["student-1", "student-2"],
      completionStatus: "GRADUATED",
    });
  });

  it("manages selected students without duplicate IDs", () => {
    expect(toggleSelectedStudent(["one"], "one", true)).toEqual(["one"]);
    expect(toggleSelectedStudent(["one"], "two", true)).toEqual([
      "one",
      "two",
    ]);
    expect(toggleSelectedStudent(["one", "two"], "one", false)).toEqual([
      "two",
    ]);
  });

  it("requires a reason for an authorised override", () => {
    expect(
      validatePromotionDraft({
        ...draft,
        academicOverride: true,
        academicOverrideReason: "short",
      }),
    ).toMatch(/at least 10/i);
  });

  it("clears every incompatible source and destination selection", () => {
    expect(
      promotionAfterSourceAcademicYearChange(draft, "year-previous"),
    ).toMatchObject({
      sourceAcademicYearId: "year-previous",
      sourceProgrammeId: "",
      sourceStudyYear: "",
      sourceSectionId: "",
      studentPublicIds: [],
      targetSectionId: "",
    });
    expect(
      promotionAfterSourceProgrammeChange(draft, "programme-ece"),
    ).toMatchObject({
      sourceProgrammeId: "programme-ece",
      sourceStudyYear: "",
      sourceSectionId: "",
      studentPublicIds: [],
    });
    expect(promotionAfterSourceStudyYearChange(draft, "3")).toMatchObject({
      sourceStudyYear: "3",
      sourceSectionId: "",
      studentPublicIds: [],
    });
  });

  it("removes the target Study Year filter only during an audited override", () => {
    expect(promotionTargetSectionFilters(draft).studyYear).toBe("3");
    expect(
      promotionTargetSectionFilters({ ...draft, academicOverride: true })
        .studyYear,
    ).toBeUndefined();
  });
});
