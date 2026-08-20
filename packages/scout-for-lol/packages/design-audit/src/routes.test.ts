import { describe, expect, test } from "bun:test";
import { themes, viewports } from "./constants.ts";
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
    expect(routes.filter((route) => route.surface === "docs")).toHaveLength(28);
    expect(routes.filter((route) => route.surface === "app")).toHaveLength(21);
  });

  test("includes every authenticated app route as read-only", () => {
    const routes = appRoutes();
    expect(routes.find((route) => route.name === "login")?.authenticated).toBe(
      false,
    );
    expect(routes.filter((route) => route.authenticated)).toHaveLength(
      routes.length - 1,
    );
    expect(routes.some((route) => route.path.endsWith("/new"))).toBe(true);
    expect(routes.some((route) => route.path.endsWith("/edit"))).toBe(true);
  });
});
