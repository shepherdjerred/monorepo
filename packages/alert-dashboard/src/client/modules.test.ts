import { GaugeIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { registry } from "./modules.ts";
import {
  CORE_MODULE_ID,
  resolveModules,
  type ClientModule,
} from "./platform/module.ts";

function Page(): null {
  return null;
}

function module(overrides: Partial<ClientModule>): ClientModule {
  return {
    id: "notes",
    title: "Notes",
    icon: GaugeIcon,
    basePath: "/notes",
    routes: [{ path: "", page: Page }],
    nav: [{ label: "Notes", icon: GaugeIcon, path: "" }],
    ...overrides,
  };
}

const core = module({ id: CORE_MODULE_ID, basePath: "" });

describe("the composed module registry", () => {
  it("keeps every URL the app served before the module platform", () => {
    expect(
      registry.routes.map((route) => `${route.chrome} ${route.path}`),
    ).toEqual([
      "bare /promotion",
      "shell /",
      "shell /services",
      "shell /services/:id",
      "shell /delivery",
      "shell /ai",
      "shell /maintenance",
      "shell /review",
      "shell /alerts",
      "shell /alerts/:id",
      "shell /history",
      "shell /system",
    ]);
  });

  it("keeps the primary navigation in order", () => {
    expect(registry.nav.map((item) => `${item.label} ${item.to}`)).toEqual([
      "Overview /",
      "Services /services",
      "Delivery /delivery",
      "AI /ai",
      "Promotion /promotion",
      "Maintenance /maintenance",
      "Review /review",
      "Alerts /alerts",
      "History /history",
      "System /system",
    ]);
  });

  it("has unique module ids and route paths", () => {
    const ids = registry.modules.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = registry.routes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("points every nav entry at a declared route", () => {
    const paths = new Set(registry.routes.map((route) => route.path));
    for (const item of registry.nav) expect(paths).toContain(item.to);
  });
});

describe("module validation", () => {
  it("prefixes a module's routes and nav with its basePath", () => {
    const resolved = resolveModules([
      core,
      module({
        routes: [
          { path: "", page: Page },
          { path: "entries/:id", page: Page },
        ],
      }),
    ]);
    expect(resolved.routes.map((route) => route.path)).toEqual([
      "/",
      "/notes",
      "/notes/entries/:id",
    ]);
    expect(resolved.nav.map((item) => item.to)).toEqual(["/", "/notes"]);
  });

  it("rejects duplicate module ids", () => {
    expect(() =>
      resolveModules([module({}), module({ basePath: "/other" })]),
    ).toThrow('Duplicate module id "notes"');
  });

  it("lets only the core module use an empty basePath", () => {
    expect(() => resolveModules([core, module({ basePath: "" })])).toThrow(
      "only the core module may use",
    );
    expect(() =>
      resolveModules([module({ id: CORE_MODULE_ID, basePath: "/core" })]),
    ).toThrow('The core module must use basePath ""');
  });

  it("rejects two modules claiming the same basePath", () => {
    expect(() =>
      resolveModules([
        module({ routes: [], nav: [] }),
        module({ id: "journal", routes: [], nav: [] }),
      ]),
    ).toThrow('basePath "/notes" is claimed by both "notes" and "journal"');
  });

  it("rejects a core route under another module's basePath", () => {
    expect(() =>
      resolveModules([
        module({
          id: CORE_MODULE_ID,
          basePath: "",
          routes: [{ path: "notes/archive", page: Page }],
        }),
        module({}),
      ]),
    ).toThrow('sits under the basePath of "notes"');
  });

  it("rejects the same route declared twice", () => {
    expect(() =>
      resolveModules([
        module({
          routes: [
            { path: "", page: Page },
            { path: "", page: Page },
          ],
        }),
      ]),
    ).toThrow('Route "/notes" is declared by both');
  });

  it("rejects a basePath the server answers itself", () => {
    expect(() => resolveModules([module({ basePath: "/api" })])).toThrow(
      "is served by the server",
    );
  });

  it("rejects absolute and wildcard route paths", () => {
    expect(() =>
      resolveModules([module({ routes: [{ path: "/entries", page: Page }] })]),
    ).toThrow("must be relative");
    expect(() =>
      resolveModules([module({ routes: [{ path: "*", page: Page }] })]),
    ).toThrow("must be relative");
  });
});
