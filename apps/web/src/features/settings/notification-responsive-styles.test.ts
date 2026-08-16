import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stylesheet(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("notification UI responsive styles", () => {
  it("keeps dashboard metrics compact across phone and tablet layouts", () => {
    const css = stylesheet("../dashboard/operations-summary.module.css");

    expect(css).toContain("@media (max-width: 1100px)");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("contains dashboard breakdown rows inside their responsive cards", () => {
    const css = stylesheet("../dashboard/admin-dashboard.module.css");

    expect(css).toMatch(/\.dashboardGrid,[\s\S]*?min-width:\s*0;/u);
    expect(css).toMatch(/\.breakdownCard\s*\{[\s\S]*?overflow:\s*hidden;/u);
    expect(css).toMatch(/\.breakdownRow\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  });

  it("keeps banners short and every banner action touch friendly", () => {
    const css = stylesheet("../dashboard/dashboard-alerts.module.css");

    expect(css).toContain("min-height: 44px");
    expect(css).toContain("-webkit-line-clamp: 3");
    expect(css).toContain("@media (max-width: 700px)");
  });

  it("contains settings tables and preserves 44px switches and inputs", () => {
    const css = stylesheet("./notification-preferences.module.css");

    expect(css).toMatch(/\.page\s*\{[\s\S]*?min-width:\s*0;/u);
    expect(css).toMatch(/\.section\s*\{[\s\S]*?min-width:\s*0;/u);
    expect(css).toMatch(/\.matrixScroller\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/u);
    expect(css).toMatch(/\.switch\s*\{[\s\S]*height: 44px/);
    expect(css).toMatch(/\.field input\s*\{[\s\S]*min-height: 44px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.footer\s*\{[\s\S]*?bottom:\s*calc\(136px/u);
    expect(css).toContain("@media (max-width: 420px)");
  });

  it("keeps sidebar navigation and count badges accessible", () => {
    const css = stylesheet("../../components/app-shell.module.css");

    expect(css).toMatch(/\.navigationLink\s*\{[\s\S]*min-height: 44px/);
    expect(css).toContain(".counterBadge");
    expect(css).toContain(".criticalCounter");
  });

  it("keeps the global install prompt from covering notification UI actions", () => {
    const css = stylesheet("../../app/globals.css");

    expect(css).toMatch(/body:has\(\[data-notification-ui="true"\]\) \.pwa-install-button\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/u);
  });
});
