import { describe, expect, test } from "vitest";
import { themes, viewports } from "./constants.ts";
import {
  auditCases,
  auditCaseTags,
  auditProjectGrep,
  auditProjects,
  includesAuditCase,
} from "./matrix.ts";
import { appRoutes, auditRoutes } from "./routes.ts";

describe("Scout design audit matrix", () => {
  test("covers the four supported themes and four viewport classes", () => {
    expect(themes.map((theme) => theme.name)).toEqual([
      "modern-light",
      "modern-dark",
      "classic-light",
      "classic-dark",
    ]);
    expect(viewports.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "laptop",
      "tablet",
      "mobile",
    ]);
  });

  test("has unique route names and paths", () => {
    const routes = auditRoutes();
    expect(new Set(routes.map((route) => route.name)).size).toBe(routes.length);
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length);
    expect(routes.filter((route) => route.surface === "public")).toHaveLength(
      6,
    );
    expect(routes.filter((route) => route.surface === "docs")).toHaveLength(29);
    expect(routes.filter((route) => route.surface === "app")).toHaveLength(23);
    expect(routes.filter((route) => route.golden)).toHaveLength(16);
  });

  test("runs exactly the intentional 616 browser cases", () => {
    const cases = auditCases();
    const keys = cases.map(
      ({ project, route, theme }) =>
        `${project.name}/${route.name}/${theme.name}`,
    );
    expect(cases).toHaveLength(616);
    expect(new Set(keys).size).toBe(cases.length);

    for (const project of auditProjects) {
      for (const route of auditRoutes()) {
        for (const theme of themes) {
          const title = `${route.surface}/${route.name} · ${theme.name} ${auditCaseTags(route, theme).join(" ")}`;
          expect(
            auditProjectGrep(project).test(title),
            `${project.name}/${route.name}/${theme.name}`,
          ).toBe(includesAuditCase(project, route, theme));
        }
      }
    }
  });

  test("preserves theme, responsive, golden, and WebKit coverage", () => {
    const cases = auditCases();
    const contains = (
      projectName: string,
      routeName: string,
      themeName: string,
    ): boolean =>
      cases.some(
        ({ project, route, theme }) =>
          project.name === projectName &&
          route.name === routeName &&
          theme.name === themeName,
      );

    for (const route of auditRoutes()) {
      for (const theme of themes) {
        expect(contains("chromium-desktop", route.name, theme.name)).toBe(true);
      }
      expect(contains("chromium-tablet", route.name, "classic-light")).toBe(
        true,
      );
      expect(contains("chromium-mobile", route.name, "classic-light")).toBe(
        true,
      );
      expect(contains("webkit-desktop", route.name, "modern-light")).toBe(true);
      expect(contains("webkit-mobile", route.name, "modern-light")).toBe(true);

      if (route.golden) {
        for (const viewport of viewports) {
          for (const theme of themes) {
            expect(
              contains(`chromium-${viewport.name}`, route.name, theme.name),
            ).toBe(true);
          }
        }
      }
    }
  });

  test("includes every authenticated app route as read-only", () => {
    const routes = appRoutes();
    expect(routes.find((route) => route.name === "login")?.authenticated).toBe(
      false,
    );
    expect(routes.filter((route) => route.authenticated)).toHaveLength(
      routes.length - 2,
    );
    expect(routes.some((route) => route.path.endsWith("/new"))).toBe(true);
    expect(routes.some((route) => route.path.endsWith("/edit"))).toBe(true);
  });
});
