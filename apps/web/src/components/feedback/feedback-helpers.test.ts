import { describe, expect, it } from "vitest";
import {
  acquireDecodeLock,
  extractFeedbackToken,
  resetDecodeLock,
  safeFeedbackPhotoSource,
} from "./feedback-helpers";

describe("extractFeedbackToken", () => {
  it.each([
    [" FB_demo_123 ", "FB_demo_123"],
    [
      "https://campus.example/student/feedback/target/FB_demo_123",
      "FB_demo_123",
    ],
    [
      "https://campus.example/student/feedback/target/FB_demo_123/?source=poster",
      "FB_demo_123",
    ],
  ])("extracts a token from %s", (raw, expected) => {
    expect(extractFeedbackToken(raw)).toBe(expected);
  });

  it("returns an empty token for whitespace", () => {
    expect(extractFeedbackToken("   ")).toBe("");
  });
});

describe("decode lock", () => {
  it("accepts only the first decode until explicitly reset", () => {
    const lock = { current: false };
    expect(acquireDecodeLock(lock)).toBe(true);
    expect(acquireDecodeLock(lock)).toBe(false);
    resetDecodeLock(lock);
    expect(acquireDecodeLock(lock)).toBe(true);
  });
});

describe("safeFeedbackPhotoSource", () => {
  it("allows local and same-origin images but rejects storage keys and foreign URLs", () => {
    expect(
      safeFeedbackPhotoSource("/images/staff.png", "https://campus.example"),
    ).toBe("/images/staff.png");
    expect(
      safeFeedbackPhotoSource(
        "https://campus.example/images/staff.png",
        "https://campus.example",
      ),
    ).toBe("/images/staff.png");
    expect(
      safeFeedbackPhotoSource(
        "colleges/private/staff.png",
        "https://campus.example",
      ),
    ).toBeNull();
    expect(
      safeFeedbackPhotoSource(
        "https://other.example/staff.png",
        "https://campus.example",
      ),
    ).toBeNull();
  });
});
