import { expect, test, vi } from "vitest";
import {
  readLiveVersionCatalogSource,
  readPublishedVersionCatalogSource,
  retainPublishedImagePins,
  resolveImageReleaseCatalog,
} from "./live-version-catalog.ts";
import {
  parseVersionCatalogText,
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

test("retains a new image's first publication before commit-back", () => {
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
  expect(() =>
    retainPublishedImagePins(bootstrap, bootstrap, candidates(200)),
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

test("a withdrawn Workflow candidate cannot return through a retained release", () => {
  const candidate = "worker/workflows/candidate";
  const main = catalog([
    ["worker", pin(100)],
    [candidate, pin(100)],
  ]);
  const previous = catalog([
    ["worker", pin(200)],
    [candidate, pin(200)],
  ]);
  const result = retainPublishedImagePins(main, previous, candidates(300), {
    [candidate]: 200,
  });
  expect(
    entries(result).map((entry) => [entry.name, entry.value]),
  ).toContainEqual([candidate, pin(100)]);
  expect(
    entries(result).map((entry) => [entry.name, entry.value]),
  ).toContainEqual(["worker", pin(200)]);
  expect(
    retainPublishedImagePins(main, result, candidates(301), {
      [candidate]: 200,
    }),
  ).toBe(result);
});

test("a newer candidate survives the withdrawal cutoff across pending commit-back", () => {
  const candidate = "worker/workflows/candidate";
  const main = catalog([[candidate, pin(100)]]);
  const published = retainPublishedImagePins(
    main,
    main,
    candidates(300, [candidate]),
    { [candidate]: 200 },
  );
  const next = retainPublishedImagePins(main, published, candidates(301), {
    [candidate]: 200,
  });
  expect(entries(next)[0]?.value).toBe(pin(300, "b"));
});

test("release resolution reads the committed withdrawal before retaining artifacts", async () => {
  const candidate = "worker/workflows/candidate";
  const main = catalog([[candidate, pin(100)]]);
  const previous = catalog([[candidate, pin(200)]]);
  const state = JSON.stringify({
    schema: "pin-candidates-state/v1",
    pins: {},
    withdrawnCandidates: { [candidate]: 200 },
  });
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) => {
      if (command[2] === "origin/main:scripts/pin-candidates-state.json")
        return commandResult(0, state);
      return commandResult(0, command[1] === "show" ? main : "");
    },
    {
      CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "300",
    },
    async (key) => (key === "version-catalog" ? previous : candidates(300)),
  );
  expect(entries(release.catalog)[0]?.value).toBe(pin(100));
});

test.each(["missing", "invalid"])(
  "release resolution refuses %s withdrawal state",
  async (mode) => {
    const main = catalog([["worker", pin(100)]]);
    await expect(
      resolveImageReleaseCatalog(
        "current",
        async (command) => {
          if (command[2] === "origin/main:scripts/pin-candidates-state.json")
            return commandResult(mode === "missing" ? 1 : 0, "{}");
          return commandResult(0, command[1] === "show" ? main : "");
        },
        {
          CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
          CI_LAST_IMAGE_RELEASE_PIPELINE: "300",
        },
        async () => {
          throw new Error("Must validate state before handoff reads");
        },
      ),
    ).rejects.toThrow(
      mode === "missing"
        ? "Unable to read live image pin state"
        : "Invalid input",
    );
  },
);

test.each([
  ["{", "pin candidate state is not valid JSON"],
  [
    JSON.stringify({
      schema: "pin-candidates-state/v1",
      pins: {},
      withdrawnCandidates: { "unknown/workflows/candidate": 200 },
    }),
    "withdrawn candidate contains unknown image key",
  ],
  ...["unknown", "upstream/chart", "worker"].map((key) => [
    JSON.stringify({
      schema: "pin-candidates-state/v1",
      pins: {
        [key]: {
          version: "2.0.0-200",
          digest: `sha256:${"a".repeat(64)}`,
          buildNumber: 200,
        },
      },
    }),
    key === "worker"
      ? "pin state drift"
      : "pin state contains unknown image key",
  ]),
  [
    JSON.stringify({
      schema: "pin-candidates-state/v1",
      pins: {
        "worker/workflows/candidate": {
          version: "2.0.0-100",
          digest: `sha256:${"a".repeat(64)}`,
          buildNumber: 100,
        },
      },
      withdrawnCandidates: { "worker/workflows/candidate": 200 },
    }),
    "withdrawn candidate remains in pin state",
  ],
])(
  "refuses corrupt live pin state before reading artifacts: %s",
  async (state, error) => {
    const main = catalog([
      ["worker", pin(100)],
      ["worker/workflows/candidate", pin(100)],
    ]);
    const readHandoff = vi.fn(async () => main);
    await expect(
      resolveImageReleaseCatalog(
        "current",
        async (command) =>
          commandResult(
            0,
            command[2] === "origin/main:scripts/pin-candidates-state.json"
              ? state
              : command[1] === "show"
                ? main
                : "",
          ),
        {
          CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
          CI_LAST_IMAGE_RELEASE_PIPELINE: "300",
        },
        readHandoff,
      ),
    ).rejects.toThrow(error);
    expect(readHandoff).not.toHaveBeenCalled();
  },
);

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

test("uses the validated baseline for both target selection and retained pins", async () => {
  const main = catalog([["worker", pin(100)]]);
  const commands: string[] = [];
  const reads: string[] = [];
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) => {
      commands.push(command.join(" "));
      if (command[2] === "origin/main:scripts/pin-candidates-state.json") {
        return commandResult(
          0,
          JSON.stringify({
            schema: "pin-candidates-state/v1",
            pins: {
              worker: {
                version: "2.0.0-100",
                digest: `sha256:${"a".repeat(64)}`,
                buildNumber: 100,
              },
            },
          }),
        );
      }
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
    "git show origin/main:scripts/pin-candidates-state.json",
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

test("validates withdrawals against live main even when the build predates a new key", async () => {
  const source = catalog([["worker", pin(100)]], "1.11.9");
  const live = catalog(
    [
      ["worker", pin(200)],
      ["future/workflows/candidate", pin(100)],
    ],
    "1.11.10",
  );
  const release = await resolveImageReleaseCatalog(
    "current",
    async (command) => {
      if (command[2] === "origin/main:scripts/pin-candidates-state.json")
        return commandResult(
          0,
          JSON.stringify({
            schema: "pin-candidates-state/v1",
            pins: {},
            withdrawnCandidates: { "future/workflows/candidate": 200 },
          }),
        );
      return commandResult(
        0,
        command[1] === "show"
          ? command[2]?.startsWith("current:")
            ? source
            : live
          : "",
      );
    },
    {
      CI_LAST_IMAGE_RELEASE_COMMIT: "published-source",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "300",
    },
    async (key) =>
      key === "version-catalog" ? live : candidates(300, ["worker"]),
  );
  expect(entries(release.catalog)).toEqual(
    entries(catalog([["worker", pin(300, "b")]], "1.11.9")),
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
      async (command) =>
        commandResult(
          0,
          command[2] === "origin/main:scripts/pin-candidates-state.json"
            ? JSON.stringify({ schema: "pin-candidates-state/v1", pins: {} })
            : command[1] === "show"
              ? main
              : "",
        ),
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
