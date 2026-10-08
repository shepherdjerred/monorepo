import { expect, test } from "vitest";
import {
  readLiveVersionCatalogSource,
  readPublishedVersionCatalogSource,
  retainPublishedImagePins,
} from "./live-version-catalog.ts";
import {
  parseVersionCatalogText,
  type VersionCatalogEntry,
} from "../../../packages/version-catalog/src/index.ts";
import type { LiveCatalogExecutor } from "./live-version-catalog.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

function commandResult(exitCode = 0, stdout = ""): BuildxCommandResult {
  return { exitCode, stdout, stderr: "" };
}

const CATALOG = JSON.stringify({
  entries: [
    {
      name: "shepherdjerred/temporal-worker/workflows/stable",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
    {
      name: "shepherdjerred/temporal-worker/workflows/candidate",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
  ],
});

test("returns the live catalog without consulting the version-bump branch", async () => {
  const commands: string[] = [];
  const executor: LiveCatalogExecutor = async (command) => {
    commands.push(command.join(" "));
    return command[1] === "fetch" ? commandResult() : commandResult(0, CATALOG);
  };
  await expect(readLiveVersionCatalogSource(executor)).resolves.toBe(CATALOG);
  expect(commands).toEqual([
    "git fetch --no-tags --depth=100 origin main",
    "git show origin/main:packages/version-catalog/src/catalog.json",
  ]);
});

test("fails transiently when origin main cannot be refreshed", async () => {
  await expect(
    readLiveVersionCatalogSource(async () => commandResult(1)),
  ).rejects.toThrow(TransientError);
});

test("fails transiently when the live version catalog cannot be read", async () => {
  await expect(
    readLiveVersionCatalogSource(async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(1),
    ),
  ).rejects.toThrow(TransientError);
});

test("rejects malformed live version catalogs", async () => {
  for (const malformedCatalog of [
    JSON.stringify({ entries: "invalid" }),
    JSON.stringify({ entries: ["invalid"] }),
  ]) {
    await expect(
      readLiveVersionCatalogSource(async (command) =>
        command[1] === "fetch"
          ? commandResult()
          : commandResult(0, malformedCatalog),
      ),
    ).rejects.toThrow("Live version catalog has an invalid");
  }
});

function catalog(
  pins: readonly (readonly [string, string])[],
  upstream = "1.0",
  notes = "current main",
): string {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [
      ...pins.map(([name, value]) => ({
        name,
        value,
        category: "internal-image",
        artifactType: "image",
        management: { managed: false },
        notes: [notes],
      })),
      {
        name: "upstream/chart",
        value: upstream,
        category: "upstream",
        artifactType: "helm-chart",
        management: { managed: false },
      },
    ],
  });
}
function pin(build: number, digest = "a"): string {
  return `2.0.0-${build.toString()}@sha256:${digest.repeat(64)}`;
}
function candidates(
  build: number,
  keys: readonly string[] = [],
  digest = "b",
): string {
  return JSON.stringify({
    schema: "pin-candidates/v1",
    buildNumber: build,
    candidates: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          version: `2.0.0-${build.toString()}`,
          digest: `sha256:${digest.repeat(64)}`,
        },
      ]),
    ),
  });
}
function entries(source: string): readonly VersionCatalogEntry[] {
  return parseVersionCatalogText(source).entries;
}

test("retains published pins across partial and consecutive no-target releases", () => {
  const stable = "worker/workflows/stable";
  const candidate = "worker/workflows/candidate";
  const main = catalog([
    ["worker", pin(100)],
    [stable, pin(100)],
    [candidate, pin(100)],
    ["other", pin(100)],
  ]);
  const released = retainPublishedImagePins(
    main,
    main,
    candidates(200, ["worker", candidate]),
  );
  const next = retainPublishedImagePins(
    main,
    released,
    candidates(201, ["other"], "c"),
  );
  const noop = retainPublishedImagePins(main, next, candidates(202));
  const secondNoop = retainPublishedImagePins(main, noop, candidates(203));
  expect(entries(secondNoop).map((entry) => [entry.name, entry.value])).toEqual(
    [
      ["worker", pin(200, "b")],
      [stable, pin(100)],
      [candidate, pin(200, "b")],
      ["other", pin(201, "c")],
      ["upstream/chart", "1.0"],
    ],
  );
});

test("current main owns newer pins, upstream versions, metadata and retired keys", () => {
  const previous = catalog(
    [
      ["worker", pin(100)],
      ["retired", pin(100)],
    ],
    "1.0",
    "old note",
  );
  const main = catalog(
    [
      ["worker", pin(300)],
      ["new", pin(300)],
    ],
    "2.0",
    "new note",
  );
  const result = retainPublishedImagePins(
    main,
    previous,
    candidates(200, ["worker", "retired"]),
  );
  expect(entries(result)).toEqual(entries(main));
});

test("rejects conflicting digests at the same release rather than choosing one", () => {
  const main = catalog([["worker", pin(200)]]);
  expect(() =>
    retainPublishedImagePins(main, main, candidates(200, ["worker"])),
  ).toThrow("Conflicting published image pins");
});

test("rejects unknown candidate keys, invalid versions and malformed handoffs", () => {
  const main = catalog([["worker", pin(100)]]);
  expect(() =>
    retainPublishedImagePins(main, main, candidates(200, ["unknown"])),
  ).toThrow("unknown internal image key");
  expect(() =>
    retainPublishedImagePins(main, main, candidates(200, ["upstream/chart"])),
  ).toThrow("unknown internal image key");
  expect(() =>
    retainPublishedImagePins(
      main,
      main,
      candidates(200, ["worker"]).replace("2.0.0-200", "2.0.0-201"),
    ),
  ).toThrow("version does not match its build");
  expect(() =>
    retainPublishedImagePins(
      main,
      catalog([["worker", "invalid"]]),
      candidates(200),
    ),
  ).toThrow("Invalid internal image release pin");
  expect(() => retainPublishedImagePins(main, main, "{}")).toThrow();
});

test("requires both handoffs from the same completed pipeline", async () => {
  const main = catalog([["worker", pin(100)]]);
  const reads: string[] = [];
  const result = await readPublishedVersionCatalogSource(
    main,
    "6485",
    async (key, pipeline) => {
      reads.push(`${pipeline}/${key}`);
      return key === "version-catalog" ? main : candidates(200, ["worker"]);
    },
  );
  expect(reads).toEqual(["6485/version-catalog", "6485/pin-candidates"]);
  expect(entries(result)[0]?.value).toBe(pin(200, "b"));
  await expect(
    readPublishedVersionCatalogSource(main, "6485", async () => {
      throw new Error("required handoff is missing");
    }),
  ).rejects.toThrow("required handoff is missing");
  await expect(
    readPublishedVersionCatalogSource(main, "../6485", async () => main),
  ).rejects.toThrow("Image release pipeline");
});
