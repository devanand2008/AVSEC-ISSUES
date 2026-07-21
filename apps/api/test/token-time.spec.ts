import { durationSeconds } from "../src/modules/auth/token-time";
describe("durationSeconds", () => {
  it.each([["15m",900],["7d",604800],["2h",7200],["30s",30]])("parses %s", (input, expected) => expect(durationSeconds(input)).toBe(expected));
  it("rejects unsupported durations", () => expect(() => durationSeconds("forever")).toThrow());
});
