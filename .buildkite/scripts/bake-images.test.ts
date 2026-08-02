import { expect, test } from "bun:test";
import {
  annotate,
  ensureBuilder,
  execute,
  lastGreenCommit,
  manifestDigest,
  pushImages,
  runSmoke,
  selectedTargets,
  type CommandExecutor,
  writeFallbackReport,
} from "./bake-images.ts";
import {
  CI_IMAGE_IGNORED_ENV_PREFIXES,
  imageRuntimeFingerprint,
  runExactCandidateSmoke,
  runtimeFingerprintFromImage,
} from "./application-image-runtime.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../scripts/lib/transient.ts";
import {
  caddyfileEntitlementArguments,
  expandTargets,
  findManagedImagePin,
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

async function currentGreenCommit(): Promise<string> {
  return "current";
}

async function invalidManifestExecutor(): Promise<BuildxCommandResult> {
  return commandResult(0, JSON.stringify({ digest: "latest" }));
}

async function failingExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1);
}

async function transientInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    1,
    "",
    "error: failed to do request: connection reset by peer",
  );
}

async function notFoundInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1, "", "ghcr.io/example: manifest unknown: not found");
}

async function imageExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    0,
    JSON.stringify({
      architecture: "amd64",
      os: "linux",
      rootfs: { type: "layers", diff_ids: ["sha256:one", "sha256:two"] },
      config: { Cmd: ["bun", "src/index.ts"], WorkingDir: "/app" },
      created: "ignored",
      history: [{ created: "ignored" }],
    }),
  );
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

test("selects the exact commit-back pin and never the prod promotion pin", () => {
  const betaDigest = `sha256:${"a".repeat(64)}`;
  const prodDigest = `sha256:${"b".repeat(64)}`;
  expect(
    findManagedImagePin(
      [
        `  "shepherdjerred/example/prod": "2.0.0-1@${prodDigest}",`,
        `  "shepherdjerred/example/beta":`,
        `    "2.0.0-2@${betaDigest}",`,
      ].join("\n"),
      "example",
    ),
  ).toEqual({
    key: "shepherdjerred/example/beta",
    digest: betaDigest,
  });
  expect(findManagedImagePin("", "example")).toBeUndefined();
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

test("resolves the newest green Buildkite commit, including the current head", async () => {
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
  ).toBe("green-commit");
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

test("builds every known image target for the fixed CI I/O corpus", async () => {
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult(0, '["birmel"]');
  };

  expect(
    await selectedTargets(
      {
        affected: false,
        push: true,
        environment: {
          CI_IO_FIXED_CORPUS: "true",
          BUILDKITE_BRANCH: "main",
        },
      },
      "current",
      executor,
      greenCommit,
    ),
  ).toEqual({
    targets: knownImageTargets,
    fallbackReason: "fixed CI I/O corpus requested",
  });
  expect(commands).toEqual([]);
});

test("uses a same-head green base as an empty image diff", async () => {
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult(0, "[]\n");
  };

  expect(
    await selectedTargets(
      { affected: false, push: true },
      "current",
      executor,
      currentGreenCommit,
    ),
  ).toEqual({ targets: [], fallbackReason: "" });
  expect(commands[0]).toContain("current");
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

test("fingerprints rootfs and runtime OCI config without build identity", async () => {
  const base = {
    architecture: "amd64",
    os: "linux",
    rootfs: { type: "layers", diff_ids: ["sha256:one"] },
    config: {
      Cmd: ["bun", "src/index.ts"],
      Env: ["PATH=/usr/bin", "VERSION=1", "GIT_SHA=old"],
      WorkingDir: "/app",
    },
    created: "yesterday",
    history: [{ created_by: "old builder" }],
  };
  const reordered = {
    history: [{ created_by: "new builder" }],
    created: "today",
    config: {
      WorkingDir: "/app",
      Env: ["PATH=/usr/bin", "VERSION=2", "GIT_SHA=new"],
      Cmd: ["bun", "src/index.ts"],
    },
    rootfs: { diff_ids: ["sha256:one"], type: "layers" },
    os: "linux",
    architecture: "amd64",
  };
  expect(runtimeFingerprintFromImage(reordered)).toBe(
    runtimeFingerprintFromImage(base),
  );
  expect(
    runtimeFingerprintFromImage({
      ...base,
      config: { ...base.config, Cmd: ["bun", "src/worker.ts"] },
    }),
  ).not.toBe(runtimeFingerprintFromImage(base));
  expect(
    runtimeFingerprintFromImage({
      ...base,
      config: { ...base.config, User: "1001:1001" },
    }),
  ).not.toBe(runtimeFingerprintFromImage(base));
  expect(
    runtimeFingerprintFromImage({ ...base, "os.version": "next" }),
  ).not.toBe(runtimeFingerprintFromImage(base));
  expect(await imageRuntimeFingerprint("example:tag", imageExecutor)).toMatch(
    /^[a-f\d]{64}$/,
  );
  expect(
    await imageRuntimeFingerprint("example:tag", failingExecutor),
  ).toBeUndefined();
  expect(() => runtimeFingerprintFromImage({})).toThrow(
    "architecture, os, and rootfs",
  );
});

test("keeps build-identity env for CI images while dropping it for application images", () => {
  const base = {
    architecture: "amd64",
    os: "linux",
    rootfs: { type: "layers", diff_ids: ["sha256:one"] },
    config: {
      Env: ["PATH=/usr/bin", "VERSION=1", "GIT_SHA=old"],
    },
  };
  const bumped = {
    ...base,
    config: { Env: ["PATH=/usr/bin", "VERSION=2", "GIT_SHA=new"] },
  };
  // Application default treats VERSION=/GIT_SHA= as disposable build identity.
  expect(runtimeFingerprintFromImage(bumped)).toBe(
    runtimeFingerprintFromImage(base),
  );
  // CI images carry no disposable identity, so those entries are meaningful
  // configuration and must change the fingerprint.
  expect(
    runtimeFingerprintFromImage(bumped, CI_IMAGE_IGNORED_ENV_PREFIXES),
  ).not.toBe(runtimeFingerprintFromImage(base, CI_IMAGE_IGNORED_ENV_PREFIXES));
});

test("surfaces a transient inspect failure instead of collapsing it to undefined", async () => {
  const image = `ghcr.io/example@sha256:${"a".repeat(64)}`;
  // A transient registry/BuildKit failure must be preserved as a retryable
  // TransientError, not silently misclassified as an unresolvable image.
  await expect(
    imageRuntimeFingerprint(image, transientInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);

  // A genuine, non-transient "not found" remains `undefined` — the legitimate
  // pin-unresolvable signal.
  expect(
    await imageRuntimeFingerprint(image, notFoundInspectExecutor),
  ).toBeUndefined();
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

test("runs application smoke against the exact candidate digest", async () => {
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult();
  };
  const digest = `sha256:${"a".repeat(64)}`;
  await runExactCandidateSmoke(
    {
      target: "scout-for-lol",
      candidate: `ghcr.io/shepherdjerred/scout-for-lol@${digest}`,
      contractHash: "contract",
    },
    executor,
    {},
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toContain(
    ".buildkite/application-image-smoke.Dockerfile",
  );
  expect(commands[0]).toContain(
    `CANDIDATE_IMAGE=ghcr.io/shepherdjerred/scout-for-lol@${digest}`,
  );
  expect(commands[0]).toContain("SMOKE_TARGET=scout-for-lol");
  expect(commands[0]).toContain("EXPECTED_CONTRACT_HASH=contract");
  await expect(
    runExactCandidateSmoke(
      {
        target: "infra",
        candidate: "example@sha256:bad",
        contractHash: "",
      },
      executor,
      {},
    ),
  ).rejects.toThrow("not defined");
});

test("smokes exact candidates, reuses identical runtime fingerprints, and tags Starlight", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const pinned = `sha256:${"a".repeat(64)}`;
  const commands: string[][] = [];
  const events: string[] = [];
  const manifestReferences: string[] = [];
  const metadata: Readonly<Record<string, string>>[] = [];
  const candidateMetadata: {
    digests: Readonly<Record<string, string>>;
    buildNumber: string;
  }[] = [];
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
          `  "shepherdjerred/birmel": "2.0.0-1@${pinned}",`,
          `  "shepherdjerred/scout-for-lol/beta": "2.0.0-2@${pinned}",`,
          `  "shepherdjerred/scout-for-lol/prod": "2.0.0-1@${pinned}",`,
          `  "shepherdjerred/starlight-karma-bot/beta": "2.0.0-2@${pinned}",`,
          `  "shepherdjerred/starlight-karma-bot/prod": "2.0.0-1@${pinned}",`,
        ].join("\n"),
      getManifestDigest: async (image) => {
        manifestReferences.push(image);
        return digest;
      },
      getRuntimeFingerprint: async (image) => {
        events.push(`fingerprint:${image}`);
        if (image.includes("scout-for-lol")) {
          return "same";
        }
        if (image.includes("starlight-karma-bot") && image.endsWith(pinned)) {
          return;
        }
        return image.endsWith(pinned) ? "old" : "new";
      },
      smokeCandidate: async (target, candidate) => {
        events.push(`smoke:${target}:${candidate}`);
      },
      writeMetadata: async (value) => {
        metadata.push(value);
      },
      writeCandidates: async (digests, buildNumber) => {
        candidateMetadata.push({ digests, buildNumber });
      },
      writeText: async (path, contents) => {
        writes.push({ path, contents });
      },
    },
  );

  expect(commands[0]).toContain("--push");
  expect(commands.some((command) => command.includes("imagetools"))).toBe(true);
  expect(manifestReferences).toEqual([
    "ghcr.io/shepherdjerred/birmel:candidate-commit",
    "ghcr.io/shepherdjerred/scout-for-lol:candidate-commit",
    "ghcr.io/shepherdjerred/starlight-karma-bot:candidate-commit",
  ]);
  expect(events[0]).toBe(
    `smoke:birmel:ghcr.io/shepherdjerred/birmel@${digest}`,
  );
  expect(events[1]).toBe(`fingerprint:ghcr.io/shepherdjerred/birmel@${digest}`);
  expect(events).toContain(
    `smoke:scout-for-lol:ghcr.io/shepherdjerred/scout-for-lol@${digest}`,
  );
  expect(metadata).toEqual([
    {
      "shepherdjerred/birmel": digest,
      "shepherdjerred/starlight-karma-bot/beta": digest,
    },
  ]);
  expect(candidateMetadata).toEqual([
    {
      digests: {
        "shepherdjerred/birmel": digest,
        "shepherdjerred/starlight-karma-bot/beta": digest,
      },
      buildNumber: "42",
    },
  ]);
  expect(JSON.parse(writes[0]?.contents ?? "")).toEqual([
    { image: "birmel", outcome: "bumped" },
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
