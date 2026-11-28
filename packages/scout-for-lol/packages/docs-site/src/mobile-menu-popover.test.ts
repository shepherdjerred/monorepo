import { describe, expect, test } from "vitest";
import path from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;

const htmlRelativePaths = [
  ...new Bun.Glob("**/*.html").scanSync({ cwd: DIST, onlyFiles: true }),
].sort();

const cssRelativePaths = [
  ...new Bun.Glob("**/*.css").scanSync({ cwd: DIST, onlyFiles: true }),
].sort();

function extractOpeningTag(html: string, prefix: string): string | undefined {
  const start = html.indexOf(prefix);
  if (start === -1) {
    return undefined;
  }
  const end = html.indexOf(">", start);
  return end === -1 ? undefined : html.slice(start, end + 1);
}

describe("Starlight mobile menu popover contract", () => {
  test("every sidebar page binds MobileMenuToggle popovertarget to sl-sidebar-pane[popover]", async () => {
    const sidebarPages: string[] = [];
    for (const rel of htmlRelativePaths) {
      const html = await Bun.file(path.join(DIST, rel)).text();
      if (!html.includes("data-has-sidebar")) {
        continue;
      }
      sidebarPages.push(rel);
      expect(html, `${rel}: MobileMenuToggle popovertarget`).toContain(
        'popovertarget="starlight__sidebar"',
      );
      const paneTag = extractOpeningTag(html, "<sl-sidebar-pane ");
      expect(paneTag, `${rel}: sl-sidebar-pane element`).toBeDefined();
      expect(paneTag, `${rel}: id="starlight__sidebar"`).toContain(
        'id="starlight__sidebar"',
      );
      expect(paneTag, `${rel}: sidebar-pane class`).toContain("sidebar-pane");
      expect(
        paneTag !== undefined &&
          (paneTag.includes(' popover=""') ||
            paneTag.includes(" popover ") ||
            paneTag.endsWith(" popover>")),
        `${rel}: popover attribute on ${paneTag ?? "missing"}`,
      ).toBe(true);
      expect(
        html,
        `${rel}: legacy starlight-menu-button removed`,
      ).not.toContain("<starlight-menu-button");
    }
    expect(sidebarPages.length).toBeGreaterThanOrEqual(15);
  });

  test("built stylesheets use popover state rather than legacy aria-expanded sibling visibility", async () => {
    expect(cssRelativePaths.length).toBeGreaterThan(0);
    const stylesheets = await Promise.all(
      cssRelativePaths.map((rel) => Bun.file(path.join(DIST, rel)).text()),
    );
    const combinedCss = stylesheets.join("\n");

    expect(combinedCss).not.toContain("--sl-sidebar-visibility");
    expect(combinedCss).not.toContain('[aria-expanded="true"]');
    expect(combinedCss).not.toContain("[aria-expanded=true]");
    expect(combinedCss).toContain(":popover-open");
  });
});
