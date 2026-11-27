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
  it("serves Home at the root and Flow at /flow, keeps /overview and /delivery for their redirects, and registers Hub 2.0 facet pages", () => {
    expect(
      registry.routes.map((route) => `${route.chrome} ${route.path}`),
    ).toEqual([
      "shell /the-storm",
      "shell /promotion",
      "shell /",
      "shell /overview",
      "shell /cluster",
      "shell /services",
      "shell /services/:id",
      "shell /monorepo",
      "shell /flow",
      "shell /delivery",
      "shell /renovate",
      "shell /product",
      "shell /ai",
      "shell /maintenance",
      "shell /review",
      "shell /reports",
      "shell /reports/runs/:id",
      "shell /reports/digests/:kind/:periodKey",
      "shell /reports/mail/:id",
      "shell /alerts",
      "shell /alerts/:id",
      "shell /house",
      "shell /history",
      "shell /system",
      "shell /traces",
      "shell /traces/:traceId",
      "shell /brim",
      "shell /brim/usage",
      "shell /brim/sessions",
      "shell /brim/sessions/:sessionId",
      "shell /brim/sessions/:sessionId/requests/:captureId",
      "shell /brim/priorities",
    ]);
  });

  it("groups the primary navigation under Ops, Alerts, and The Storm", () => {
    expect(
      registry.navGroups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => `${item.label} ${item.to}`),
      })),
    ).toEqual([
      {
        label: "Ops",
        items: [
          "Home /",
          "Cluster /cluster",
          "Services /services",
          "Monorepo /monorepo",
          "Flow /flow",
          "Renovate /renovate",
          "Product /product",
          "AI /ai",
          "Maintenance /maintenance",
          "Review /review",
          "Reports /reports",
          "Traces /traces",
          "Brim /brim",
        ],
      },
      {
        label: "Alerts",
        items: [
          "Active /alerts",
          "House /house",
          "History /history",
          "System /system",
        ],
      },
      {
        label: "The Storm",
        items: ["Overview /the-storm", "Promotion /promotion"],
      },
    ]);
  });

  it("lists every module's navigation entries in module declaration order, with full names", () => {
    expect(registry.nav.map((item) => item.title)).toEqual([
      "Home",
      "Cluster",
      "Services",
      "Monorepo",
      "Flow",
      "Renovate",
      "Product",
      "AI",
      "Maintenance",
      "Review",
      "Reports",
      "Active alerts",
      "House",
      "History",
      "System",
      "The Storm overview",
      "Promotion",
      "LLM traces",
      "Brim",
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

  it("groups a nav entry under its module title unless it names a group", () => {
    const resolved = resolveModules([
      core,
      module({
        routes: [
          { path: "", page: Page },
          { path: "archive", page: Page },
          { path: "tags", page: Page },
        ],
        nav: [
          { label: "Notes", icon: GaugeIcon, path: "" },
          { label: "Tags", group: "Library", icon: GaugeIcon, path: "tags" },
          {
            label: "Archive",
            title: "Notes archive",
            icon: GaugeIcon,
            path: "archive",
          },
        ],
      }),
      module({
        id: "journal",
        title: "Journal",
        basePath: "/journal",
        nav: [{ label: "Entries", group: "Notes", icon: GaugeIcon, path: "" }],
      }),
    ]);
    expect(
      resolved.navGroups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => item.to),
      })),
    ).toEqual([
      { label: "Notes", items: ["/", "/notes", "/notes/archive", "/journal"] },
      { label: "Library", items: ["/notes/tags"] },
    ]);
    expect(resolved.nav.map((item) => `${item.group}: ${item.title}`)).toEqual([
      "Notes: Notes",
      "Notes: Notes",
      "Library: Tags",
      "Notes: Notes archive",
      "Notes: Entries",
    ]);
  });

  it("rejects a blank nav group", () => {
    expect(() =>
      resolveModules([
        module({
          nav: [{ label: "Notes", group: " ", icon: GaugeIcon, path: "" }],
        }),
      ]),
    ).toThrow('Module "notes" nav entry "Notes" has a blank group');
    expect(() => resolveModules([module({ title: "" })])).toThrow(
      "has a blank group",
    );
  });

  it("rejects the same nav target declared twice", () => {
    expect(() =>
      resolveModules([
        module({
          nav: [
            { label: "Notes", icon: GaugeIcon, path: "" },
            { label: "All notes", icon: GaugeIcon, path: "" },
          ],
        }),
      ]),
    ).toThrow('Nav entry "/notes" is declared by both "notes" and "notes"');
  });

  it("rejects a nav entry that points at no declared route", () => {
    expect(() =>
      resolveModules([
        module({
          nav: [{ label: "Archive", icon: GaugeIcon, path: "archive" }],
        }),
      ]),
    ).toThrow(
      'Nav entry "/notes/archive" of "notes" points at no declared route',
    );
    expect(() =>
      resolveModules([
        module({
          routes: [{ path: "entries/:id", page: Page }],
          nav: [{ label: "Entry", icon: GaugeIcon, path: "entries" }],
        }),
      ]),
    ).toThrow("points at no declared route");
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
