import { expect, test } from "bun:test";
import {
  annotate,
  ensureBuilder,
  execute,
  imageLayers,
  lastGreenCommit,
  manifestDigest,
  pushImages,
  runSmoke,
  selectedTargets,
  type CommandExecutor,
  writeFallbackReport,
} from "./bake-images.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import {
  caddyfileEntitlementArguments,
  expandTargets,
  findPinnedDigest,
  knownImageTargets,
  parseBakeArguments,
  parseBuildkiteCommits,
  parseImageSelection,
  parseStringArray,
} from "./migration-core.ts";

function commandResult(
  exitCode = 0,
  stdout = "",
  stderr = "",
): BuildxCommandResult {
  return { exitCode, stdout, stderr };
}

async function targetSelectionFailureExecutor(
  command: readonly string[],
): Promise<BuildxCommandResult> {
  return command.includes("merge-base")
    ? commandResult(0, "base\n")
    : commandResult(1);
}

async function scopedPushExecutor(): Promise<BuildxCommandResult> {
  return commandResult(0, '["scout-for-lol"]');
}

async function greenCommit(): Promise<string> {
  return "green";
}

async function invalidManifestExecutor(): Promise<BuildxCommandResult> {
  return commandResult(0, JSON.stringify({ digest: "latest" }));
}

async function failingExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1);
}

async function layerExecutor(): Promise<BuildxCommandResult> {
  return commandResult(0, '["sha256:one","sha256:two"]');
}

test("grants caddyfile read access to smoke and push bakes", () => {
  expect(
    caddyfileEntitlementArguments(
      ["birmel", "caddy-s3proxy"],
      "/tmp/caddyfile.generated",
    ),
  ).toEqual(["--allow", "fs.read=/tmp/caddyfile.generated"]);
  expect(caddyfileEntitlementArguments(["birmel"])).toEqual([]);
  expect(() => caddyfileEntitlementArguments(["caddy-s3proxy"])).toThrow(
    "CADDYFILE_SMOKE_PATH is required for caddy-s3proxy",
  );
});

test("expands the infra group into invokable targets", () => {
  expect(expandTargets(["infra"])).toContain("caddy-s3proxy");
  expect(expandTargets(["infra"])).not.toContain("infra");
});

test("reads production and beta image pins", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(
    findPinnedDigest(
      `  "shepherdjerred/example/beta": {\n    digest: "${digest}",\n`,
      "example",
    ),
  ).toBe(digest);
  expect(findPinnedDigest("", "example")).toBeUndefined();
});

test("only accepts documented flags", () => {
  expect(parseBakeArguments(["--affected"])).toEqual({
    affected: true,
    push: false,
  });
  expect(() => parseBakeArguments(["--unknown"])).toThrow("Unknown");
  expect(knownImageTargets).toContain("scout-for-lol");
});

test("validates external JSON arrays", () => {
  expect(parseStringArray(["one", "two"], "targets")).toEqual(["one", "two"]);
  expect(() => parseStringArray({}, "targets")).toThrow("array");
  expect(() => parseStringArray(["one", 2], "targets")).toThrow(
    "only contain strings",
  );
  expect(parseBuildkiteCommits([{ commit: "one" }, { commit: "two" }])).toEqual(
    ["one", "two"],
  );
  expect(() => parseBuildkiteCommits({})).toThrow("array");
  expect(() => parseBuildkiteCommits([{}])).toThrow("contain a commit");
});

test("fails open when image selection output is malformed", () => {
  for (const output of ["not-json", "{}", '["birmel", 42]']) {
    const result = parseImageSelection(output);
    expect(result.targets).toEqual(knownImageTargets);
    expect(result.fallbackReason).toContain("malformed output");
  }
});

test("fails open when image selection names an unknown target", () => {
  const result = parseImageSelection('["unknown-image"]');
  expect(result.targets).toEqual(knownImageTargets);
  expect(result.fallbackReason).toBe("image selector returned invalid targets");
});

test("executes commands and preserves stdout, stderr, and exit status", async () => {
  const result = await execute([
    "bun",
    "-e",
    'console.log("command-output"); console.error("command-error")',
  ]);
  expect(result).toEqual({
    exitCode: 0,
    stdout: "command-output\n",
    stderr: "command-error\n",
  });
});

test("annotates with the expected report arguments", async () => {
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult();
  };

  await annotate(["--report", "selection.json"], executor);

  expect(commands).toEqual([
    [
      "bun",
      "--no-install",
      ".buildkite/scripts/annotate-image-summary.ts",
      "--report",
      "selection.json",
    ],
  ]);
});

test("resolves the last distinct green Buildkite commit", async () => {
  const fetcher = Object.assign(
    async () => Response.json([{ commit: "green-commit" }], { status: 200 }),
    { preconnect: fetch.preconnect },
  );
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult();
  };

  expect(
    await lastGreenCommit("current", fetcher, executor, {
      BUILDKITE_API_TOKEN: "token",
    }),
  ).toBe("green-commit");
  expect(commands).toEqual([
    ["git", "cat-file", "-e", "green-commit^{commit}"],
  ]);
  expect(
    await lastGreenCommit("current", fetcher, executor, {}),
  ).toBeUndefined();
  expect(
    await lastGreenCommit("green-commit", fetcher, executor, {
      BUILDKITE_API_TOKEN: "token",
    }),
  ).toBeUndefined();
});

test("selects affected image targets from the merge base", async () => {
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    if (command.includes("merge-base")) {
      return commandResult(0, "base-commit\n");
    }
    return commandResult(0, '["birmel"]\n');
  };

  expect(
    await selectedTargets({ affected: true, push: false }, "current", executor),
  ).toEqual({
    targets: ["birmel"],
    fallbackReason: "",
  });
  expect(commands[1]).toEqual([
    "bun",
    "--no-install",
    ".buildkite/scripts/select-image-targets.ts",
    "--base",
    "base-commit",
    "--reasons-out",
    "image-selection-report.json",
  ]);
});

test("falls back to all images when target selection fails", async () => {
  expect(
    await selectedTargets(
      { affected: true, push: false },
      "current",
      targetSelectionFailureExecutor,
    ),
  ).toEqual({
    targets: knownImageTargets,
    fallbackReason: "image selector failed",
  });
  expect(
    await selectedTargets(
      { affected: false, push: false },
      "current",
      targetSelectionFailureExecutor,
    ),
  ).toEqual({
    targets: knownImageTargets,
    fallbackReason: "full build requested (no --affected/--push scoping)",
  });
});

test("uses the last green commit for scoped pushes", async () => {
  expect(
    await selectedTargets(
      { affected: false, push: true },
      "current",
      scopedPushExecutor,
      greenCommit,
    ),
  ).toEqual({
    targets: ["scout-for-lol"],
    fallbackReason: "",
  });
});

test("validates image manifest digests", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const success: CommandExecutor = async () =>
    commandResult(0, JSON.stringify({ digest }));

  expect(await manifestDigest("example:tag", success)).toBe(digest);
  await expect(
    manifestDigest("example:tag", invalidManifestExecutor),
  ).rejects.toThrow("Invalid manifest digest");
  await expect(manifestDigest("example:tag", failingExecutor)).rejects.toThrow(
    "Could not inspect",
  );
});

test("returns image layers only for successful inspections", async () => {
  expect(await imageLayers("example:tag", layerExecutor)).toEqual([
    "sha256:one",
    "sha256:two",
  ]);
  expect(await imageLayers("example:tag", failingExecutor)).toBeUndefined();
});

test("creates the remote BuildKit builder only when missing", async () => {
  const existing: string[][] = [];
  await ensureBuilder(async (command) => {
    existing.push([...command]);
    return commandResult();
  });
  expect(existing).toEqual([["docker", "buildx", "inspect", "ci"]]);

  const created: string[][] = [];
  await ensureBuilder(async (command) => {
    created.push([...command]);
    return command.includes("inspect") ? commandResult(1) : commandResult();
  });
  expect(created).toHaveLength(2);
  expect(created[1]).toContain(
    "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
  );
});

test("runs smoke targets with contract and Caddyfile inputs", async () => {
  const commands: string[][] = [];
  const environments: Readonly<Record<string, string | undefined>>[] = [];
  const executor: CommandExecutor = async (command, environment) => {
    commands.push([...command]);
    environments.push(environment ?? {});
    return commandResult();
  };

  await runSmoke(["caddy-s3proxy"], "contract", executor, {
    CADDYFILE_SMOKE_PATH: "/tmp/Caddyfile",
  });

  expect(commands[0]).toContain("caddy-s3proxy");
  expect(commands[0]).toContain("fs.read=/tmp/Caddyfile");
  expect(environments[0]).toMatchObject({
    VERSION: "dev",
    GIT_SHA: "unknown",
    CONTRACT_HASH: "contract",
    PUSH_CACHE: "false",
  });
});

test("pushes images, reuses identical layers, and tags Starlight", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const pinned = `sha256:${"a".repeat(64)}`;
  const commands: string[][] = [];
  const metadata: Readonly<Record<string, string>>[] = [];
  const writes: { path: string; contents: string }[] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult();
  };

  await pushImages(
    {
      targets: ["birmel", "scout-for-lol", "starlight-karma-bot"],
      commit: "commit",
      buildNumber: "42",
      contractHash: "contract",
    },
    {
      executor,
      environment: {},
      readVersions: async () =>
        [
          `  "shepherdjerred/scout-for-lol/prod": "2.0.0-1@${pinned}",`,
          `  "shepherdjerred/starlight-karma-bot/prod": "2.0.0-1@${pinned}",`,
        ].join("\n"),
      getManifestDigest: async () => digest,
      getImageLayers: async (image) =>
        image.includes("scout-for-lol") ? ["same"] : undefined,
      writeMetadata: async (value) => {
        metadata.push(value);
      },
      writeText: async (path, contents) => {
        writes.push({ path, contents });
      },
    },
  );

  expect(commands[0]).toContain("--push");
  expect(commands.some((command) => command.includes("imagetools"))).toBe(true);
  expect(metadata).toEqual([
    {
      "shepherdjerred/birmel": digest,
      "shepherdjerred/starlight-karma-bot": digest,
    },
  ]);
  expect(JSON.parse(writes[0]?.contents ?? "")).toEqual([
    { image: "birmel", outcome: "no-pin-bumped" },
    { image: "scout-for-lol", outcome: "content-unchanged" },
    {
      image: "starlight-karma-bot",
      outcome: "pin-unresolvable-bumped",
    },
  ]);
});

test("writes a deterministic full-build fallback report", async () => {
  const writes: { path: string; contents: string }[] = [];

  await writeFallbackReport(
    ["birmel", "scout-for-lol"],
    "selector failed",
    async (path, contents) => {
      writes.push({ path, contents });
    },
  );

  expect(writes[0]?.path).toBe("image-selection-report.json");
  expect(JSON.parse(writes[0]?.contents ?? "")).toEqual({
    base: null,
    changedPaths: [],
    mode: "all",
    globalReason: "selector failed",
    targets: {
      birmel: ["selector failed"],
      "scout-for-lol": ["selector failed"],
    },
  });
});
