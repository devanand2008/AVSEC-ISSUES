export interface AvsEngineeringAcademicStructureEntry {
  code: string;
  name: string;
  aliases: readonly string[];
  sortOrder: number;
  degreeTypeCode: "BE" | "BTECH";
  programmeCode: string;
  programmeName: string;
  legacyProgrammeCodes: readonly string[];
  sections: readonly string[];
}

/**
 * Canonical AVS Engineering College department/programme/initial-section matrix.
 * Section names are deliberately scoped under their programme/semester and must
 * never be materialized as department codes such as CSE(A).
 */
export const AVS_ENGINEERING_ACADEMIC_STRUCTURE = [
  {
    code: "AI & ML",
    name: "Artificial Intelligence and Machine Learning",
    aliases: ["CSE(AI&ML)", "AI&ML", "AIML", "AI-ML"],
    sortOrder: 10,
    degreeTypeCode: "BE",
    programmeCode: "AIML",
    programmeName: "Artificial Intelligence and Machine Learning",
    legacyProgrammeCodes: ["BTECH-AIML", "CSE(AI&ML)"],
    sections: ["A"],
  },
  {
    code: "AI & DS",
    name: "Artificial Intelligence and Data Science",
    aliases: ["AI&DS", "AIDS", "AI-DS"],
    sortOrder: 20,
    degreeTypeCode: "BTECH",
    programmeCode: "AIDS",
    programmeName: "Artificial Intelligence and Data Science",
    legacyProgrammeCodes: ["BTECH-AIDS"],
    sections: ["A", "B", "C"],
  },
  {
    code: "CSE",
    name: "Computer Science and Engineering",
    aliases: [],
    sortOrder: 30,
    degreeTypeCode: "BE",
    programmeCode: "CSE",
    programmeName: "Computer Science and Engineering",
    legacyProgrammeCodes: ["BTECH-CSE"],
    sections: ["A", "B", "C"],
  },
  {
    code: "IT",
    name: "Information Technology",
    aliases: [],
    sortOrder: 40,
    degreeTypeCode: "BTECH",
    programmeCode: "IT",
    programmeName: "Information Technology",
    legacyProgrammeCodes: ["BTECH-IT"],
    sections: ["A", "B"],
  },
  {
    code: "ECE",
    name: "Electronics and Communication Engineering",
    aliases: [],
    sortOrder: 50,
    degreeTypeCode: "BE",
    programmeCode: "ECE",
    programmeName: "Electronics and Communication Engineering",
    legacyProgrammeCodes: ["BTECH-ECE"],
    sections: ["A", "B"],
  },
  {
    code: "EEE",
    name: "Electrical and Electronics Engineering",
    aliases: [],
    sortOrder: 60,
    degreeTypeCode: "BE",
    programmeCode: "EEE",
    programmeName: "Electrical and Electronics Engineering",
    legacyProgrammeCodes: ["BTECH-EEE"],
    sections: ["A"],
  },
  {
    code: "MECH",
    name: "Mechanical Engineering",
    aliases: ["ME"],
    sortOrder: 70,
    degreeTypeCode: "BE",
    programmeCode: "MECH",
    programmeName: "Mechanical Engineering",
    legacyProgrammeCodes: ["BTECH-MECH"],
    sections: ["A"],
  },
  {
    code: "BME",
    name: "Biomedical Engineering",
    aliases: [],
    sortOrder: 80,
    degreeTypeCode: "BE",
    programmeCode: "BME",
    programmeName: "Biomedical Engineering",
    legacyProgrammeCodes: ["BTECH-BME"],
    sections: ["A"],
  },
] as const satisfies readonly AvsEngineeringAcademicStructureEntry[];

export const AVS_DEPARTMENT_IMPORT_ALIASES = {
  "AI&ML": "AI & ML",
  "AI & ML": "AI & ML",
  AIML: "AI & ML",
  "AI-ML": "AI & ML",
  "AI&DS": "AI & DS",
  "AI & DS": "AI & DS",
  AIDS: "AI & DS",
  "AI-DS": "AI & DS",
  ME: "MECH",
} as const;
