import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/(portal)/notifications/notifications.module.css"), "utf8");

describe("notification center responsive styles", () => {
  it("keeps all interactive notification controls at least 44 CSS pixels tall", () => {
    expect(css).toMatch(/\.actionButton\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(css).toMatch(/\.metadata a\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(css).toMatch(/\.moreMenu summary\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(css).toMatch(/\.filterTab\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(css).toMatch(/\.searchField input\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(css).toMatch(/\.control select\s*\{[\s\S]*?min-height:\s*44px;/u);
  });

  it("uses horizontally scrollable required tabs and a compact mobile filter trigger", () => {
    expect(css).toMatch(/\.filterTabs\s*\{[\s\S]*?overflow-x:\s*auto;/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.desktopControls\s*\{[\s\S]*?display:\s*none;/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.mobileFilterButton\s*\{[\s\S]*?display:\s*inline-flex;/u);
  });

  it("stacks notification content safely at narrow phone widths", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*?\.notificationItem\s*\{[\s\S]*?grid-template-columns:\s*32px minmax\(0,\s*1fr\);/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*?\.actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u);
  });
});
