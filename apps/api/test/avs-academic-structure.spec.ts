import { AVS_ENGINEERING_ACADEMIC_STRUCTURE } from "../src/modules/academic/avs-academic-structure";

describe("AVS Engineering College canonical academic structure", () => {
  it("contains exactly the eight required departments with professional names", () => {
    expect(AVS_ENGINEERING_ACADEMIC_STRUCTURE.map(({ code, name }) => ({ code, name }))).toEqual([
      { code: "AI & ML", name: "Artificial Intelligence and Machine Learning" },
      { code: "AI & DS", name: "Artificial Intelligence and Data Science" },
      { code: "CSE", name: "Computer Science and Engineering" },
      { code: "IT", name: "Information Technology" },
      { code: "ECE", name: "Electronics and Communication Engineering" },
      { code: "EEE", name: "Electrical and Electronics Engineering" },
      { code: "MECH", name: "Mechanical Engineering" },
      { code: "BME", name: "Biomedical Engineering" },
    ]);
  });

  it("contains the exact required initial section matrix", () => {
    expect(Object.fromEntries(AVS_ENGINEERING_ACADEMIC_STRUCTURE.map((entry) => [entry.code, [...entry.sections]]))).toEqual({
      "AI & ML": ["A"],
      "AI & DS": ["A", "B", "C"],
      CSE: ["A", "B", "C"],
      IT: ["A", "B"],
      ECE: ["A", "B"],
      EEE: ["A"],
      MECH: ["A"],
      BME: ["A"],
    });
  });

  it("never encodes a section as a department", () => {
    expect(AVS_ENGINEERING_ACADEMIC_STRUCTURE.every((entry) => !(/\([A-Z]\)$|\[[A-Z]\]$/).test(entry.code))).toBe(true);
    expect(new Set(AVS_ENGINEERING_ACADEMIC_STRUCTURE.map((entry) => entry.code)).size).toBe(8);
  });

  it("reuses explicit legacy AI department aliases instead of creating duplicates", () => {
    const aliases = Object.fromEntries(
      AVS_ENGINEERING_ACADEMIC_STRUCTURE.map((entry) => [
        entry.code,
        [...entry.aliases],
      ]),
    );
    expect(aliases["AI & ML"]).toEqual(
      expect.arrayContaining(["CSE(AI&ML)", "AI&ML", "AIML", "AI-ML"]),
    );
    expect(aliases["AI & DS"]).toEqual(
      expect.arrayContaining(["AI&DS", "AIDS", "AI-DS"]),
    );
  });
});
