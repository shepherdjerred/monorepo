import { describe, expect, test } from "vitest";

import { describeFlagUsageDrift } from "../checks/check-flag-usage.ts";
import {
  extractJavaHits,
  extractTypeScriptHits,
  isScannedPath,
} from "./flag-usage-extract.ts";
import {
  buildFlagUsageIndex,
  type FlagUsageIndex,
  loadScopes,
  scopeErrors,
} from "./flag-usage.ts";

const KEYS = new Set([
  "demo-enabled",
  "demo-limit",
  "player-card-enabled",
  "debug",
]);

function hits(source: string, file = "packages/demo/src/x.ts") {
  return extractTypeScriptHits(source, file, KEYS);
}

describe("extractTypeScriptHits", () => {
  test("counts call arguments in any position, through wrappers", () => {
    expect(
      hits(`
        isEnabled("demo-enabled");
        numberValue(client, "demo-limit" as const);
        new Gate(("demo-enabled"));
      `),
    ).toEqual([
      { key: "demo-enabled", kind: "call-argument" },
      { key: "demo-limit", kind: "call-argument" },
      { key: "demo-enabled", kind: "call-argument" },
    ]);
  });

  test("counts array elements and named constants", () => {
    expect(
      hits(`
        export const KEYS = ["demo-enabled", "demo-limit"] as const;
        const FLAG: FlagKey = "demo-limit";
        class Gate { static readonly key = "demo-enabled"; }
      `),
    ).toEqual([
      { key: "demo-enabled", kind: "array-element" },
      { key: "demo-limit", kind: "array-element" },
      { key: "demo-limit", kind: "constant" },
      { key: "demo-enabled", kind: "constant" },
    ]);
  });

  test("counts an explicit names.flag and not the derived name beside it", () => {
    expect(
      hits(`
        defineConfig({
          playerCardEnabled: {
            schema: flagValueSchema("demo-limit"),
            sources: ["flag", "default"],
            names: { flag: "demo-limit", env: "DEMO_LIMIT" },
          },
        });
      `),
    ).toEqual([
      { key: "demo-limit", kind: "call-argument" },
      { key: "demo-limit", kind: "config-flag-name" },
    ]);
  });

  test("derives the flag key of a flag-sourced definition", () => {
    expect(
      hits(`
        const DEFINITION = {
          playerCardEnabled: {
            sources: ["flag", "env", "default"],
            names: { env: "PLAYER_CARD_ENABLED" },
          },
          demoEnabled: { sources: ["env", "default"] },
          "demo-limit": { sources: ["flag"], names: SHARED_NAMES },
        };
      `),
    ).toEqual([{ key: "player-card-enabled", kind: "config-derived" }]);
  });

  test("ignores literal types, satisfies types and type arguments", () => {
    expect(
      hits(`
        type Key = "demo-enabled" | "demo-limit";
        const table = {} satisfies Record<"demo-enabled", boolean>;
        read<"demo-limit">(table);
        function gate(key: "debug" = fallback): void {}
      `),
    ).toEqual([]);
  });

  test("ignores other literal positions", () => {
    expect(
      hits(`
        const level = env.LEVEL ?? "debug";
        if (mode === "demo-enabled") {}
        const map = { "demo-limit": 1, value: "demo-enabled" };
        log.info(\`demo-\${"x"}\`);
      `),
    ).toEqual([]);
  });

  test("parses TSX", () => {
    expect(
      hits(
        `export const View = () => <Gate flag={useFlag("demo-enabled")} />;`,
        "packages/demo/src/view.tsx",
      ),
    ).toEqual([{ key: "demo-enabled", kind: "call-argument" }]);
  });
});

describe("extractJavaHits", () => {
  test("counts string literals and skips comments, chars and text blocks", () => {
    const source = String.raw`
      /** The {@code demo-enabled} flag, "demo-enabled" in prose. */
      class Gate {
        // "demo-limit"
        static final String KEY = "demo-enabled";
        static final char QUOTE = '"';
        static final String BLOCK = """
            "demo-limit"
            """;
        boolean on() { return flags.evaluate("demo-limit", false); }
        String escaped() { return "say \"demo-enabled\""; }
      }
    `;
    expect(extractJavaHits(source, KEYS)).toEqual([
      { key: "demo-enabled", kind: "java" },
      { key: "demo-limit", kind: "java" },
    ]);
  });
});

describe("isScannedPath", () => {
  test.each([
    "packages/demo/src/config.ts",
    "packages/demo/src/view.tsx",
    "packages/the-storm/plugin/modules/rwf/src/main/java/Gate.java",
  ])("scans %s", (file) => {
    expect(isScannedPath(file)).toBe(true);
  });

  test.each([
    "packages/demo/src/config.test.ts",
    "packages/demo/src/config.spec.tsx",
    "packages/demo/src/config.test-support.ts",
    "packages/demo/src/__tests__/config.ts",
    "packages/demo/test/config.ts",
    "packages/demo/tests/e2e/config.ts",
    "packages/demo/src/testing/fixtures.ts",
    "packages/demo/src/keys.generated.ts",
    "packages/demo/src/generated/keys.ts",
    "packages/demo/dist/config.ts",
    "packages/demo/node_modules/x/index.ts",
    "packages/demo/src/types.d.ts",
    "packages/demo/src/config.js",
    "packages/the-storm/plugin/modules/rwf/src/test/java/GateTest.java",
    "packages/other/src/main/java/Gate.java",
  ])("skips %s", (file) => {
    expect(isScannedPath(file)).toBe(false);
  });
});

describe("buildFlagUsageIndex", () => {
  const flags = [
    { key: "demo-enabled", namespace: "demo" },
    { key: "debug", namespace: "demo" },
    { key: "demo-limit", namespace: "other" },
  ];
  const scopes = { demo: ["packages/demo"], other: ["packages/other"] };

  test("counts only in-scope, non-test files and lists the rest as unreferenced", () => {
    const index = buildFlagUsageIndex(flags, scopes, [
      {
        file: "packages/demo/src/b.ts",
        package: "@demo/app",
        text: `isEnabled("demo-enabled"); isEnabled("demo-enabled");`,
      },
      {
        file: "packages/demo/src/a.ts",
        package: "@demo/app",
        text: `export const KEYS = ["demo-enabled"]; read("demo-limit");`,
      },
      {
        file: "packages/demo/src/a.test.ts",
        package: "@demo/app",
        text: `isEnabled("debug");`,
      },
      {
        file: "packages/unrelated/src/log.ts",
        package: "@demo/unrelated",
        text: `setLevel("debug");`,
      },
    ]);
    expect(index).toEqual({
      version: 1,
      flags: {
        "demo-enabled": [
          {
            package: "@demo/app",
            file: "packages/demo/src/a.ts",
            kind: "array-element",
            count: 1,
          },
          {
            package: "@demo/app",
            file: "packages/demo/src/b.ts",
            kind: "call-argument",
            count: 2,
          },
        ],
      },
      unreferenced: ["debug", "demo-limit"],
    } satisfies FlagUsageIndex);
  });

  test("fails loudly when a flag's namespace has no scope", () => {
    expect(() =>
      buildFlagUsageIndex(flags, { demo: ["packages/demo"] }, []),
    ).toThrow(/namespace "other" has no entry/u);
  });
});

describe("scopes", () => {
  test("reports missing and unknown namespaces", () => {
    expect(
      scopeErrors(["demo", "other"], {
        demo: ["packages/demo"],
        stale: ["packages/stale"],
      }),
    ).toEqual([
      'inventory namespace "other" has no entry in scripts/generate/flag-usage-scopes.json',
      'scripts/generate/flag-usage-scopes.json scopes "stale", which is not an inventory namespace',
    ]);
  });

  test("the committed scope map parses", () => {
    expect(Object.keys(loadScopes()).length).toBeGreaterThan(0);
  });
});

describe("describeFlagUsageDrift", () => {
  test("names added and removed read sites", () => {
    const entry = {
      package: "@demo/app",
      file: "packages/demo/src/a.ts",
      kind: "call-argument" as const,
      count: 1,
    };
    expect(
      describeFlagUsageDrift(
        { version: 1, flags: { "demo-enabled": [entry] }, unreferenced: [] },
        {
          version: 1,
          flags: { "demo-enabled": [{ ...entry, count: 2 }] },
          unreferenced: ["demo-limit"],
        },
      ),
    ).toEqual([
      "+ demo-enabled: packages/demo/src/a.ts (call-argument x2)",
      "- demo-enabled: packages/demo/src/a.ts (call-argument x1)",
      "+ unreferenced: demo-limit",
    ]);
  });
});
