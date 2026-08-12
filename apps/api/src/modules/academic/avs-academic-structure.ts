export interface AvsEngineeringAcademicStructureEntry {
  code: string;
  name: string;
  aliases: readonly string[];
  sortOrder: number;
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
    programmeCode: "BTECH-AIML",
    programmeName: "B.Tech Artificial Intelligence and Machine Learning",
    legacyProgrammeCodes: ["CSE(AI&ML)"],
    sections: ["A"],
  },
  {
    code: "AI & DS",
    name: "Artificial Intelligence and Data Science",
    aliases: ["AI&DS", "AIDS", "AI-DS"],
    sortOrder: 20,
    programmeCode: "BTECH-AIDS",
    programmeName: "B.Tech Artificial Intelligence and Data Science",
    legacyProgrammeCodes: [],
    sections: ["A", "B", "C"],
  },
  {
    code: "CSE",
    name: "Computer Science and Engineering",
    aliases: [],
    sortOrder: 30,
    programmeCode: "BTECH-CSE",
    programmeName: "B.Tech Computer Science and Engineering",
    legacyProgrammeCodes: [],
    sections: ["A", "B", "C"],
  },
  {
    code: "IT",
    name: "Information Technology",
    aliases: [],
    sortOrder: 40,
    programmeCode: "BTECH-IT",
    programmeName: "B.Tech Information Technology",
    legacyProgrammeCodes: [],
    sections: ["A", "B"],
  },
  {
    code: "ECE",
    name: "Electronics and Communication Engineering",
    aliases: [],
    sortOrder: 50,
    programmeCode: "BTECH-ECE",
    programmeName: "B.Tech Electronics and Communication Engineering",
    legacyProgrammeCodes: [],
    sections: ["A", "B"],
  },
  {
    code: "EEE",
    name: "Electrical and Electronics Engineering",
    aliases: [],
    sortOrder: 60,
    programmeCode: "BTECH-EEE",
    programmeName: "B.Tech Electrical and Electronics Engineering",
    legacyProgrammeCodes: [],
    sections: ["A"],
  },
  {
    code: "MECH",
    name: "Mechanical Engineering",
    aliases: ["ME"],
    sortOrder: 70,
    programmeCode: "BTECH-MECH",
    programmeName: "B.Tech Mechanical Engineering",
    legacyProgrammeCodes: [],
    sections: ["A"],
  },
  {
    code: "BME",
    name: "Biomedical Engineering",
    aliases: [],
    sortOrder: 80,
    programmeCode: "BTECH-BME",
    programmeName: "B.Tech Biomedical Engineering",
    legacyProgrammeCodes: [],
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
