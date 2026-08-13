import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("change-password responsive styles", () => {
  it("reserves space for the install prompt throughout the narrow layout", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media\s*\(max-width:\s*780px\)[\s\S]*?body:has\(\.change-pw-page\) \.change-pw-page\s*\{[^}]*padding-bottom:\s*calc\(84px \+ env\(safe-area-inset-bottom\)\);/u,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*780px\)[\s\S]*?body:has\(\.change-pw-page\) \.pwa-install-button\s*\{[^}]*position:\s*absolute;/u,
    );
  });
});
