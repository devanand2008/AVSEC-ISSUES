import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("academic workspace responsive styles", () => {
  it("stacks section rows when the detail panel is narrower than their desktop grid", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/components.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.academic-department-detail\s*\{[^}]*container-type:\s*inline-size;/su,
    );
    expect(css).toMatch(
      /@container\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.academic-section-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(css).toMatch(
      /@container\s*\(max-width:\s*720px\)[\s\S]*?\.academic-section-actions\s*\{[^}]*flex-wrap:\s*wrap;/u,
    );
  });
});
