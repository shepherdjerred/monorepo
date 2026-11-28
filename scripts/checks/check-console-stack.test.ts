import { describe, expect, test } from "vitest";
import {
  collect,
  compare,
  deviationsFor,
  renderTable,
} from "./check-console-stack.ts";
import {
  ALLOWLIST,
  CATALOG_PENDING,
  CONSOLES,
  REQUIRED,
  type AllowlistEntry,
  type ConsoleDefinition,
  type Deviation,
} from "./console-stack-rules.ts";

const ROOT = new URL("../..", import.meta.url).pathname;

const catalog = new Map([
  ["react", "19.3.1"],
  ["zod", "^4.4.3"],
  ["hono", "^4.12.18"],
]);

const typescriptConsole: ConsoleDefinition = {
  id: "demo",
  label: "Demo",
  directory: "packages/demo",
  kind: "typescript",
};

function packageWith(
  dependencies: Record<string, string>,
): Parameters<typeof deviationsFor>[1] {
  return { name: "@demo/demo", dependencies };
}

/** A package that satisfies every requirement of its kind, all from the catalog. */
function standardPackage(
  kind: ConsoleDefinition["kind"],
): Record<string, string> {
  return Object.fromEntries(
    REQUIRED[kind].map((library) => [library, "catalog:"]),
  );
}

describe("deviationsFor", () => {
  test("a console on the standard has no deviations", () => {
    expect(
      deviationsFor(
        typescriptConsole,
        packageWith(standardPackage("typescript")),
        catalog,
      ),
    ).toEqual([]);
  });

  test("reports each missing required library", () => {
    const deps = standardPackage("typescript");
    delete deps["@tanstack/react-router"];
    delete deps["prisma"];
    const keys = deviationsFor(typescriptConsole, packageWith(deps), catalog)
      .filter((item) => item.kind === "missing")
      .map((item) => item.library);
    expect(keys.toSorted()).toEqual(["@tanstack/react-router", "prisma"]);
  });

  test("reports banned alternatives, including whole scopes", () => {
    const deps = {
      ...standardPackage("typescript"),
      "react-router": "8.4.0",
      axios: "^1.0.0",
      "@radix-ui/react-dialog": "^1.0.0",
      dayjs: "^1.0.0",
      "@tailwindcss/vite": "^4.0.0",
    };
    const banned = deviationsFor(typescriptConsole, packageWith(deps), catalog)
      .filter((item) => item.kind === "banned")
      .map((item) => item.library);
    expect(banned.toSorted()).toEqual([
      "@radix-ui/react-dialog",
      "@tailwindcss/vite",
      "axios",
      "dayjs",
      "react-router",
    ]);
  });

  test("reports a catalogued library declared with its own version", () => {
    const deps = { ...standardPackage("typescript"), zod: "^4.4.3" };
    const found = deviationsFor(typescriptConsole, packageWith(deps), catalog);
    expect(found).toEqual([
      expect.objectContaining({ kind: "uncatalogued", library: "zod" }),
    ]);
  });

  test("a shared kit stands in for the libraries it provides", () => {
    const provided = new Set([
      "hono",
      "@hono/bun",
      "@trpc/server",
      "@trpc/client",
      "@trpc/tanstack-react-query",
      "@tanstack/react-query",
      "@tanstack/react-router",
    ]);
    const deps = Object.fromEntries(
      Object.entries(standardPackage("typescript")).filter(
        ([library]) => !provided.has(library),
      ),
    );
    expect(
      deviationsFor(
        typescriptConsole,
        packageWith({
          ...deps,
          "@shepherdjerred/console-server": "workspace:*",
          "@shepherdjerred/console-client": "workspace:*",
        }),
        catalog,
      ),
    ).toEqual([]);
  });

  test("workspace packages are not catalogued", () => {
    const deps = {
      ...standardPackage("typescript"),
      react: "workspace:*",
    };
    expect(
      deviationsFor(typescriptConsole, packageWith(deps), catalog),
    ).toEqual([]);
  });

  test("a Rust console needs no server stack but may not carry one", () => {
    const rust: ConsoleDefinition = {
      ...typescriptConsole,
      kind: "rust-client",
    };
    expect(
      deviationsFor(rust, packageWith(standardPackage("rust-client")), catalog),
    ).toEqual([]);
    const withHono = deviationsFor(
      rust,
      packageWith({ ...standardPackage("rust-client"), hono: "catalog:" }),
      catalog,
    );
    expect(withHono).toEqual([
      expect.objectContaining({ kind: "banned", library: "hono" }),
    ]);
  });
});

describe("compare", () => {
  const deviation: Deviation = {
    app: "demo",
    kind: "banned",
    library: "react-router",
    rule: "use TanStack Router, not react-router",
  };
  const entry: AllowlistEntry = {
    app: "demo",
    kind: "banned",
    library: "react-router",
    reason: "until the router PR",
  };

  test("an allowlisted deviation passes", () => {
    const report = compare([deviation], [entry], ["demo"]);
    expect(report.unlisted).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(report.malformed).toEqual([]);
  });

  test("a deviation without an entry fails", () => {
    expect(compare([deviation], [], ["demo"]).unlisted).toEqual([deviation]);
  });

  // The list only shrinks: fixing a deviation without deleting its entry fails.
  test("an entry whose deviation disappeared is stale", () => {
    expect(compare([], [entry], ["demo"]).stale).toEqual([entry]);
  });

  test("rejects unknown apps, empty reasons and duplicates", () => {
    const report = compare(
      [],
      [{ ...entry, app: "ghost" }, { ...entry, reason: " " }, entry, entry],
      ["demo"],
    );
    expect(report.malformed).toEqual([
      'ghost:banned:react-router: unknown app "ghost"',
      "demo:banned:react-router: missing reason",
      "demo:banned:react-router: duplicate",
      "demo:banned:react-router: duplicate",
    ]);
  });
});

describe("renderTable", () => {
  test("lists each deviation with its reason and marks clean apps", () => {
    const definitions = [
      typescriptConsole,
      { ...typescriptConsole, id: "clean", label: "Clean" },
    ];
    const table = renderTable(
      [
        {
          app: "demo",
          kind: "banned",
          library: "react-router",
          rule: "x",
        },
      ],
      [
        {
          app: "demo",
          kind: "banned",
          library: "react-router",
          reason: "until the router PR",
        },
      ],
      definitions,
    );
    expect(table).toContain("Demo");
    expect(table).toContain("react-router");
    expect(table).toContain("until the router PR");
    expect(table).toMatch(/Clean\s+-\s+-\s+on the standard/);
  });
});

describe("the repository", () => {
  test("matches the allowlist exactly", async () => {
    const { deviations, problems } = await collect(ROOT);
    const report = compare(
      deviations,
      ALLOWLIST,
      CONSOLES.map((definition) => definition.id),
    );
    expect(problems).toEqual([]);
    expect(report.malformed).toEqual([]);
    expect(report.unlisted).toEqual([]);
    expect(report.stale).toEqual([]);
  });

  test("every required library is catalogued or pending, never both", async () => {
    const { problems } = await collect(ROOT);
    expect(problems).toEqual([]);
    for (const library of CATALOG_PENDING) {
      expect(Object.values(REQUIRED).flat()).toContain(library);
    }
  });

  test("covers the ten consoles and console-ui", () => {
    expect(CONSOLES.map((definition) => definition.id)).toEqual([
      "hub",
      "delivery",
      "tracker",
      "errors",
      "mail",
      "flags",
      "feeds",
      "golink",
      "charts",
      "ci-cache",
      "console-ui",
    ]);
  });
});
