import { describe, expect, test } from "vitest";
import {
  globalNavbarCta,
  isNavLinkActive,
  parseNavbarSessionState,
  SCOUT_NAV_LINKS,
} from "#src/layout/index.tsx";

describe("global navigation", () => {
  test("uses the exact public navigation order", () => {
    expect(SCOUT_NAV_LINKS.map((link) => link.label)).toEqual([
      "Home",
      "Documentation",
      "What’s New",
      "Support",
    ]);
  });

  test("keeps the trailing call to action on one line", async () => {
    const componentCss = await Bun.file(
      new URL("../../styles/components.css", import.meta.url),
    ).text();
    expect(componentCss).toContain(".scout-navbar__utility .scout-button {");
    expect(componentCss).toContain("flex: none;");
    expect(componentCss).toContain("white-space: nowrap;");
  });

  test("matches only the intended public section", () => {
    expect(isNavLinkActive("/", "/", "exact")).toBe(true);
    expect(isNavLinkActive("/support", "/", "exact")).toBe(false);
    expect(isNavLinkActive("/docs/how-to", "/docs/", "prefix")).toBe(true);
    expect(isNavLinkActive("/docs-archive", "/docs/", "prefix")).toBe(false);
  });

  test("always returns the correct trailing session CTA", () => {
    expect(globalNavbarCta(false)).toEqual({
      label: "Get Started",
      href: "/app/login?returnTo=/app/",
    });
    expect(globalNavbarCta(undefined)).toEqual({
      label: "Get Started",
      href: "/app/login?returnTo=/app/",
    });
    expect(globalNavbarCta(true)).toEqual({
      label: "Dashboard",
      href: "/app/",
    });
  });

  test("resolves only valid session responses", () => {
    expect(
      parseNavbarSessionState({ result: { data: { user: { id: "user" } } } }),
    ).toBe(true);
    expect(parseNavbarSessionState({ result: { data: { user: null } } })).toBe(
      false,
    );
    for (const payload of [
      null,
      {},
      { result: null },
      { result: { data: {} } },
    ]) {
      expect(parseNavbarSessionState(payload)).toBeUndefined();
    }
  });
});
