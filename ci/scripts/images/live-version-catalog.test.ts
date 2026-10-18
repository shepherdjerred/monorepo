import { expect, test, vi } from "vitest";
import {
  readLiveVersionCatalogSource,
  readPublishedVersionCatalogSource,
  retainPublishedImagePins,
  resolveImageReleaseCatalog,
} from "./live-version-catalog.ts";
import {
  parseVersionCatalogText,
  serializeVersionCatalog,
  type VersionCatalogEntry,
} from "../../../packages/version-catalog/src/index.ts";
import type { LiveCatalogExecutor } from "./live-version-catalog.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";
import { UNPUBLISHED_IMAGE_DIGEST } from "../../../scripts/lib/image-pin-catalog.ts";

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

function localCatalog(value: string): string {
  const parsed = parseVersionCatalogText(
    catalog([
      ["local-image", value],
      ["worker", pin(100)],
    ]),
  );
  return serializeVersionCatalog({
    ...parsed,
    entries: parsed.entries.map((entry) =>
      entry.name === "local-image"
        ? { ...entry, imagePublisher: "local" }
        : entry,
    ),
  });
}

test("retains local bootstrap and published pins from current source across CI releases", () => {
  const bootstrap = `0.1.0-0@${UNPUBLISHED_IMAGE_DIGEST}`;
  const main = localCatalog(bootstrap);
  const released = retainPublishedImagePins(
    main,
    main,
    candidates(200, ["worker"]),
  );
  expect(entries(released)[0]?.value).toBe(bootstrap);
  expect(entries(released)[1]?.value).toBe(pin(200, "b"));
  const localPublication = `0.1.0-1@sha256:${"d".repeat(64)}`;
  const current = localCatalog(localPublication);
  const retained = retainPublishedImagePins(current, released, candidates(201));
  const next = retainPublishedImagePins(current, retained, candidates(202));
  expect(entries(next)[0]?.value).toBe(localPublication);
  expect(entries(next)[1]?.value).toBe(pin(200, "b"));
});

test("CI cannot overwrite local ownership declared by either catalog", () => {
  const local = localCatalog(`0.1.0-0@${UNPUBLISHED_IMAGE_DIGEST}`);
  const legacy = catalog([
    ["local-image", pin(100)],
    ["worker", pin(100)],
  ]);
  expect(
    entries(retainPublishedImagePins(local, legacy, candidates(200)))[0]?.value,
  ).toBe(`0.1.0-0@${UNPUBLISHED_IMAGE_DIGEST}`);
  for (const [current, previous] of [
    [local, legacy],
    [legacy, local],
    [local, local],
  ] as const) {
    expect(() =>
      retainPublishedImagePins(
        current,
        previous,
        candidates(200, ["local-image"]),
      ),
    ).toThrow("CI candidate contains locally published image key");
  }
});

test("retains a new image's first publication in producer metadata", () => {
  const name = "shepherdjerred/velero-plugin";
  const bootstrap = catalog([[name, `0.0.0@${UNPUBLISHED_IMAGE_DIGEST}`]]);
  const published = retainPublishedImagePins(
    bootstrap,
    bootstrap,
    candidates(200, [name]),
  );
  const retained = retainPublishedImagePins(
    bootstrap,
    published,
    candidates(201),
  );
  expect(entries(published)[0]?.value).toBe(pin(200, "b"));
  expect(entries(retained)[0]?.value).toBe(pin(200, "b"));
  expect(
    entries(retainPublishedImagePins(bootstrap, bootstrap, candidates(200))),
  ).toEqual(entries(bootstrap));
});

test("retains prepared image markers without regressing published pins", () => {
  const prepared = "shepherdjerred/prepared-service";
  const marker = `0.0.0@${UNPUBLISHED_IMAGE_DIGEST}`;
  const previous = catalog([
    ["worker", pin(100)],
    [prepared, marker],
  ]);
  const partial = retainPublishedImagePins(
    previous,
    previous,
    candidates(200, ["worker"]),
  );
  expect(entries(partial).map((entry) => entry.value)).toEqual([
    pin(200, "b"),
    marker,
    "1.0",
  ]);
  const current = catalog([
    ["worker", pin(200, "b")],
    [prepared, pin(300)],
  ]);
  expect(
    entries(retainPublishedImagePins(current, partial, candidates(301))),
  ).toEqual(entries(current));
  const invalid = catalog([[prepared, `0.1.0-0@${UNPUBLISHED_IMAGE_DIGEST}`]]);
  expect(() =>
    retainPublishedImagePins(invalid, previous, candidates(302)),
  ).toThrow("Invalid internal image release pin");
  expect(() =>
    retainPublishedImagePins(previous, invalid, candidates(302)),
  ).toThrow("Invalid internal image release pin");
});

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

test.each([
  "shepherdjerred/scout-for-lol/prod/workflows/stable",
  "shepherdjerred/scout-for-lol/prod/workflows/candidate",
])(
  "source bootstrap slots %s remain independent of newer producer metadata",
  (key) => {
    const main = catalog([
      [key, pin(100, "c")],
      ["worker", pin(100)],
    ]);
    const previous = catalog([
      [key, pin(200)],
      ["worker", pin(200)],
    ]);
    const released = retainPublishedImagePins(main, previous, candidates(300));
    expect(entries(released).map((entry) => [entry.name, entry.value])).toEqual(
      [
        [key, pin(100, "c")],
        ["worker", pin(200)],
        ["upstream/chart", "1.0"],
      ],
    );
    expect(retainPublishedImagePins(main, released, candidates(301))).toBe(
      released,
    );
  },
);

test.each([
  "shepherdjerred/scout-for-lol/prod/workflows/stable",
  "shepherdjerred/scout-for-lol/prod/workflows/candidate",
])("CI publication cannot mint source-owned bootstrap slot %s", (key) => {
  const main = catalog([[key, pin(100)]]);
  expect(() =>
    retainPublishedImagePins(main, main, candidates(200, [key])),
  ).toThrow("CI candidate contains source-owned bootstrap image key");
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
  expect(() => retainPublishedImagePins(main, main, "{")).toThrow(
    "pin candidates is not valid JSON",
  );
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

test("reuses immutable publication handoffs without reading Git deployment state", async () => {
  const main = catalog([["worker", pin(100)]]);
  const commands: string[] = [];
  const reads: string[] = [];
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) => {
      commands.push(command.join(" "));
      return commandResult(0, command[1] === "show" ? main : "");
    },
    {
      CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "6485",
    },
    async (key, pipeline) => {
      reads.push(`${pipeline}/${key}`);
      return key === "version-catalog" ? main : candidates(200, ["worker"]);
    },
  );
  expect(release.baseCommit).toBe("published-source");
  expect(entries(release.catalog)[0]?.value).toBe(pin(200, "b"));
  expect(commands).toEqual([
    "git fetch --no-tags --depth=100 origin main",
    "git show origin/main:packages/version-catalog/src/catalog.json",
    "git show current:packages/version-catalog/src/catalog.json",
    "git cat-file -e published-source^{commit}",
    "git merge-base --is-ancestor published-source current",
  ]);
  expect(reads).toEqual(["6485/version-catalog", "6485/pin-candidates"]);
});

test("does not reuse pins or narrow builds from a release outside current ancestry", async () => {
  const main = catalog([["worker", pin(100)]]);
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) => {
      if (command[1] === "merge-base") return commandResult(1);
      return commandResult(0, command[1] === "show" ? main : "");
    },
    {
      CI_LAST_IMAGE_RELEASE_COMMIT: "other-branch",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "6485",
    },
    async (_key, pipeline) => {
      throw new Error(`must not read unrelated pipeline ${pipeline}`);
    },
  );
  expect(release.baseCommit).toBeUndefined();
  expect(entries(release.catalog)).toEqual(entries(main));
});

test("keeps upstream versions and metadata tied to the build while advancing image pins", async () => {
  const source = catalog([["worker", pin(100)]], "1.11.9", "build source");
  const live = catalog(
    [
      ["worker", pin(200)],
      ["future", pin(200)],
    ],
    "1.11.10",
    "future source",
  );
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) =>
      commandResult(
        0,
        command[1] === "show"
          ? command[2]?.startsWith("current:")
            ? source
            : live
          : "",
      ),
    {},
  );
  expect(entries(release.catalog)).toEqual(
    entries(catalog([["worker", pin(200)]], "1.11.9", "build source")),
  );
});

test.each(["missing", "invalid"])(
  "rejects a %s build source catalog",
  async (mode) => {
    await expect(
      resolveImageReleaseCatalog(
        "current",
        async (command) => {
          if (command[2]?.startsWith("current:"))
            return commandResult(mode === "missing" ? 1 : 0, "{}");
          return commandResult(0, command[1] === "show" ? catalog([]) : "");
        },
        {},
      ),
    ).rejects.toThrow(
      mode === "missing"
        ? "Unable to read the build source version catalog"
        : "Invalid input",
    );
  },
);

test("reads the required published artifacts through the configured S3 handoff store", async () => {
  const main = catalog([["worker", pin(100)]]);
  const requested: string[] = [];
  vi.stubEnv("CI_PIPELINE_NUMBER", "7000");
  vi.stubEnv("SEAWEEDFS_HANDOFF_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY", "test-secret");
  vi.stubGlobal("fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    requested.push(path);
    return new Response(
      path.endsWith("/version-catalog.json")
        ? main
        : candidates(200, ["worker"]),
    );
  });
  try {
    const release = await resolveImageReleaseCatalog(
      "current",
      async (command) => commandResult(0, command[1] === "show" ? main : ""),
      {
        CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
        CI_LAST_IMAGE_RELEASE_PIPELINE: "6485",
      },
    );
    expect(entries(release.catalog)[0]?.value).toBe(pin(200, "b"));
    expect(requested.sort()).toEqual([
      "/ci-handoff/6485/pin-candidates.json",
      "/ci-handoff/6485/version-catalog.json",
    ]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
