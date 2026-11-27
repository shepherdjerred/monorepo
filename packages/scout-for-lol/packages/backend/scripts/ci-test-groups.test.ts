/**
 * Keeps the backend's CI test groups honest.
 *
 * `ci-tests.json` splits the CI tier into a `db` group (suites that start the
 * shared PostgreSQL server) and PostgreSQL-free shards (`free-N`) that run
 * everything else. `turbo.json` gives each group task inputs that drop the
 * test files the group never runs, so an edit to the other group's tests keeps
 * its cache hit. Both files list the `db` group's suites, and nothing else
 * ties the lists to the code, so this suite proves:
 *
 * - the free shards exclude exactly the `db` group's files and together cover
 *   every other CI-tier file (a shard count mismatch would drop a shard);
 * - a suite is in the `db` group exactly when its import graph reaches the
 *   PostgreSQL test harness, so the free group stays free of PostgreSQL;
 * - the inputs each task drops are test files that task does not run, so a
 *   cache hit can never skip a file the task executes;
 * - every `db` filter selects exactly one file, so no file runs twice;
 * - `package.json` has one `test:ci:<group>` / `test:extended:<group>` script
 *   per group and `turbo.json`'s `test:ci` / `test:extended` depend on exactly
 *   those tasks, so a forgotten script or edge silently drops a group.
 *
 * Limit: "free" is enforced by the static import graph (literal `import`,
 * dynamic `import("literal")`, `vi.mock`), and by forbidding `require()` and
 * non-literal `import(x)` anywhere under src/ and scripts/ so the graph cannot
 * be bypassed that way. A free suite that reaches PostgreSQL by another route
 * (spawning a process, a runtime-built module path) is not detected here: the
 * manifest has no per-step environment to point the free groups at an
 * unreachable `SCOUT_PG_PORT` and make that fail loudly.
 *
 * Source files are never dropped from any group's inputs: the groups import the
 * same modules, so narrowing them below the whole tree would serve stale hits.
 */
import { Glob } from "bun";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";

const backendDirectory = path.resolve(import.meta.dir, "..");

const PG_HARNESS_FILES = [
  "src/testing/test-database.ts",
  "src/testing/test-template.ts",
  "src/testing/postgres-server.ts",
  "src/testing/test-database-owner.ts",
] as const;
const PG_PACKAGE = "@shepherdjerred/test-postgres";
const INTEGRATION_EXCLUDE = "**/*.integration.test.ts";

const PackageSchema = z.object({ scripts: z.record(z.string(), z.string()) });
const StepSchema = z.object({
  group: z.string(),
  name: z.string(),
  tier: z.string().optional(),
  args: z.array(z.string()),
});
const ManifestSchema = z.object({ steps: z.array(StepSchema) });
const TurboSchema = z.object({
  tasks: z.record(
    z.string(),
    z
      .object({
        inputs: z.array(z.string()).optional(),
        dependsOn: z.array(z.string()).optional(),
      })
      .loose(),
  ),
});

async function readJsonc(name: string): Promise<unknown> {
  return Bun.JSONC.parse(
    await Bun.file(path.join(backendDirectory, name)).text(),
  );
}

async function scan(pattern: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Glob(pattern).scan({ cwd: backendDirectory })) {
    files.push(file);
  }
  return files.sort();
}

type Groups = {
  readonly dbFiles: readonly string[];
  readonly freeSteps: readonly z.infer<typeof StepSchema>[];
};

async function readGroups(): Promise<Groups> {
  const { steps } = ManifestSchema.parse(await readJsonc("ci-tests.json"));
  const ciSteps = steps.filter((step) => step.tier !== "extended");
  const db = ciSteps.filter((step) => step.group === "db");
  expect(db, "exactly one CI-tier db step").toHaveLength(1);
  const dbFiles = (db[0]?.args ?? []).filter(
    (arg, index, args) =>
      !arg.startsWith("--") &&
      args[index - 1] !== "--testTimeout" &&
      args[index - 1] !== "--exclude",
  );
  return {
    dbFiles,
    freeSteps: ciSteps.filter((step) => step.group !== "db"),
  };
}

const IMPORT_SPECIFIER =
  /(?:from\s+|import\s*\(\s*|import\s+|mock\s*\(\s*|importActual\s*(?:<[^>]*>)?\s*\(\s*)["']([^"']+)["']/gu;

type ImportGraph = ReadonlyMap<string, readonly string[]>;

/**
 * Local import edges of every TypeScript file under src/ and scripts/, with
 * the PostgreSQL test package recorded as a pseudo-file. Dynamic imports and
 * `vi.mock` targets count: a mocked module is still loaded by its importers.
 */
async function readImportGraph(): Promise<ImportGraph> {
  const files = [
    ...(await scan("src/**/*.ts")),
    ...(await scan("scripts/**/*.ts")),
  ];
  const known = new Set(files);
  const resolve = (from: string, specifier: string): string | undefined => {
    if (specifier === PG_PACKAGE) return PG_PACKAGE;
    const base = specifier.startsWith("#src/")
      ? path.posix.join("src", specifier.slice("#src/".length))
      : specifier.startsWith(".")
        ? path.posix.join(path.posix.dirname(from), specifier)
        : undefined;
    if (base === undefined) return undefined;
    return [
      base,
      base.replace(/\.js$/u, ".ts"),
      `${base}.ts`,
      path.posix.join(base, "index.ts"),
    ].find((candidate) => known.has(candidate));
  };
  const graph = new Map<string, readonly string[]>();
  for (const file of files) {
    const text = await Bun.file(path.join(backendDirectory, file)).text();
    const edges = [...text.matchAll(IMPORT_SPECIFIER)].flatMap((match) => {
      const target = resolve(file, match[1] ?? "");
      return target === undefined ? [] : [target];
    });
    graph.set(file, edges);
  }
  return graph;
}

function reachesPostgres(graph: ImportGraph, start: string): boolean {
  const seen = new Set([start]);
  const queue = [start];
  for (const file of queue) {
    if (file === PG_PACKAGE || PG_HARNESS_FILES.some((h) => h === file)) {
      return true;
    }
    for (const next of graph.get(file) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

async function ciTierTestFiles(): Promise<string[]> {
  return [
    ...(await scan("src/**/*.test.ts")),
    ...(await scan("scripts/**/*.test.ts")),
  ]
    .filter((file) => !file.endsWith(".integration.test.ts"))
    .filter((file) => file !== "scripts/branded-types.test.ts");
}

function matches(pattern: string, files: readonly string[]): string[] {
  const glob = new Glob(pattern);
  return files.filter((file) => glob.match(file));
}

/** Groups with at least one step that runs in the tier, in manifest order. */
async function groupsOfTier(tier: "ci" | "extended"): Promise<string[]> {
  const { steps } = ManifestSchema.parse(await readJsonc("ci-tests.json"));
  const groups = steps
    .filter((step) => {
      const own = step.tier ?? "ci";
      return own === tier || own === "shared";
    })
    .map((step) => step.group);
  return [...new Set(groups)];
}

describe("backend CI test groups", () => {
  test("free shards exclude exactly the db group's files and number themselves", async () => {
    const { dbFiles, freeSteps } = await readGroups();
    expect(dbFiles.length).toBeGreaterThan(0);
    expect(new Set(dbFiles).size, "db files are unique").toBe(dbFiles.length);
    expect(freeSteps.length).toBeGreaterThan(1);
    const expectedExcludes = [
      INTEGRATION_EXCLUDE,
      ...dbFiles.map((file) => `**/${file}`),
    ].sort();
    const shards: string[] = [];
    for (const step of freeSteps) {
      const excludes = step.args.flatMap((arg, index) =>
        step.args[index - 1] === "--exclude" ? [arg] : [],
      );
      expect(excludes.sort(), step.group).toEqual(expectedExcludes);
      const shard = step.args.filter((arg) => arg.startsWith("--shard="));
      expect(shard, `${step.group} has one --shard`).toHaveLength(1);
      shards.push(shard[0] ?? "");
    }
    expect(shards.sort()).toEqual(
      freeSteps.map(
        (_, index) =>
          `--shard=${String(index + 1)}/${String(freeSteps.length)}`,
      ),
    );
    expect(freeSteps.map((step) => step.group).sort()).toEqual(
      freeSteps.map((_, index) => `free-${String(index + 1)}`),
    );
  });

  test("the db group lists existing CI-tier files only", async () => {
    const { dbFiles } = await readGroups();
    const tests = new Set(await ciTierTestFiles());
    for (const file of dbFiles) {
      expect(tests.has(file), `${file} is a CI-tier test file`).toBe(true);
    }
  });

  test("a suite is in the db group exactly when it reaches the PostgreSQL harness", async () => {
    const { dbFiles } = await readGroups();
    const listed = new Set(dbFiles);
    const graph = await readImportGraph();
    const misplaced: string[] = [];
    for (const file of await ciTierTestFiles()) {
      const reaches = reachesPostgres(graph, file);
      if (reaches && !listed.has(file)) {
        misplaced.push(
          `${file}: reaches PostgreSQL; add it to the db group in ci-tests.json and drop it from the free groups' turbo inputs`,
        );
      }
      if (!reaches && listed.has(file)) {
        misplaced.push(
          `${file}: never reaches PostgreSQL; move it to the free groups`,
        );
      }
    }
    expect(misplaced).toEqual([]);
  });

  test("each group's dropped inputs are test files the group does not run", async () => {
    const { dbFiles } = await readGroups();
    const listed = new Set(dbFiles);
    const turbo = TurboSchema.parse(await readJsonc("turbo.json"));
    const tests = await ciTierTestFiles();
    const allTests = [
      ...tests,
      ...(await scan("src/**/*.integration.test.ts")),
    ];
    const dropped = (task: string): string[] => {
      const inputs = turbo.tasks[task]?.inputs;
      expect(inputs, task).toBeDefined();
      return (inputs ?? [])
        .filter((input) => input.startsWith("!"))
        .map((input) => input.slice(1));
    };

    const { freeSteps } = await readGroups();
    for (const step of freeSteps) {
      // The free shards never run the db files, and nothing else is dropped.
      expect(dropped(`test:ci:${step.group}`).sort(), step.group).toEqual(
        [...dbFiles].sort(),
      );
    }

    // The db group never runs a free file: it may drop free test files by
    // glob, but never a db file, a non-test file or a pattern matching nothing.
    const dbDropped = dropped("test:ci:db");
    expect(dbDropped.length).toBeGreaterThan(0);
    for (const pattern of dbDropped) {
      expect(pattern.endsWith(".test.ts"), `${pattern} drops tests only`).toBe(
        true,
      );
      const hit = matches(pattern, allTests);
      expect(hit, `${pattern} matches a test file`).not.toHaveLength(0);
      for (const file of hit) {
        expect(
          listed.has(file),
          `${pattern} must not drop db file ${file}`,
        ).toBe(false);
      }
    }
  });

  test("every db filter selects exactly one test file", async () => {
    const { dbFiles } = await readGroups();
    // Vitest treats a positional argument as a substring of the file path, so
    // `a.test.ts` would also select `sub/a.test.ts` and run it in two groups.
    const everyTest = await scan(
      "{src,scripts,test}/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
    );
    for (const filter of dbFiles) {
      expect(
        everyTest.filter((file) => file.includes(filter)),
        `${filter} must select exactly itself`,
      ).toEqual([filter]);
    }
  });

  test("package.json and turbo.json wire every group's task", async () => {
    const { scripts } = PackageSchema.parse(await readJsonc("package.json"));
    const turbo = TurboSchema.parse(await readJsonc("turbo.json"));
    const runner = "bun ../../../../scripts/ci/run-ci-test.ts";
    const tiers = [
      { tier: "ci", prefix: "test:ci", suffix: "" },
      { tier: "extended", prefix: "test:extended", suffix: " --tier extended" },
    ] as const;
    for (const { tier, prefix, suffix } of tiers) {
      const groups = await groupsOfTier(tier);
      expect(groups.length, `${tier} tier has groups`).toBeGreaterThan(0);
      for (const group of groups) {
        expect(scripts[`${prefix}:${group}`], `${prefix}:${group} script`).toBe(
          `${runner} --group ${group}${suffix}`,
        );
        expect(
          turbo.tasks[`${prefix}:${group}`],
          `${prefix}:${group} turbo task`,
        ).toBeDefined();
      }
      expect(
        Object.keys(scripts)
          .filter((name) => name.startsWith(`${prefix}:`))
          .sort(),
        `${prefix}:* scripts are exactly the ${tier} groups`,
      ).toEqual(groups.map((group) => `${prefix}:${group}`).sort());
      expect(
        [...(turbo.tasks[prefix]?.dependsOn ?? [])].sort(),
        `turbo.json ${prefix}.dependsOn`,
      ).toEqual(groups.map((group) => `${prefix}:${group}`).sort());
    }
  });

  test("no source file bypasses the import graph with require() or a computed import()", async () => {
    const BYPASS = /(?:^|[^\w.$/])(?:require\s*\(|import\s*\(\s*[^"'\s)])/u;
    const offenders: string[] = [];
    const files = [
      ...(await scan("src/**/*.ts")),
      ...(await scan("scripts/**/*.ts")),
    ].filter((file) => file !== "scripts/ci-test-groups.test.ts");
    for (const file of files) {
      const lines = (
        await Bun.file(path.join(backendDirectory, file)).text()
      ).split("\n");
      lines.forEach((line, index) => {
        const code = line.trimStart();
        if (code.startsWith("*") || code.startsWith("//")) return;
        if (BYPASS.test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${code}`);
        }
      });
    }
    expect(
      offenders,
      "the PostgreSQL-free check reads literal imports only; use a literal import instead",
    ).toEqual([]);
  });
});
