import { expect, test } from "vitest";
import {
  annotate,
  ensureBuilder,
  execute,
  lastSuccessfulImageReleaseCommit,
  manifestDigest,
  pushImages,
  runSmoke,
  selectedTargets,
  type CommandExecutor,
  VERSION_CATALOG_URL,
} from "./bake-images.ts";
import {
  assertNoPendingVersionBump,
  assertTemporalCandidatePinsConverged,
} from "./temporal-candidate-admission.ts";
import { writeFallbackReport } from "./image-selection-report.ts";
import { pinCandidatesForDigests } from "./pin-candidate-images.ts";
import { ensureAnonymousGhcrPull } from "./ghcr-public-access.ts";
import {
  assertImageSourceLabel,
  CI_IMAGE_IGNORED_ENV_PREFIXES,
  imageRuntimeFingerprint,
  runExactCandidateSmoke,
  runtimeFingerprintFromImage,
} from "./application-image-runtime.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";
import { productionBakeEnvironment } from "./production-bake-environment.ts";
import { ALL_IMAGE_TARGETS } from "./image-targets.ts";
import {
  caddyfileEntitlementArguments,
  expandTargets,
  knownImageTargets,
  parseBakeArguments,
  parseBuildkiteCommits,
  parseLastPassedStepsCommit,
  parseImageSelection,
  parseStringArray,
} from "./migration-core.ts";
import { findManagedImagePin } from "../../scripts/lib/image-pin-catalog.ts";
function commandResult(
  exitCode = 0,
  stdout = "",
  stderr = "",
): BuildxCommandResult {
  return { exitCode, stdout, stderr };
}
test("blocks candidate admission while the durable version branch exists", async () => {
  await expect(
    assertNoPendingVersionBump(async () =>
      commandResult(0, "abc123\trefs/heads/chore/version-bump-pending\n"),
    ),
  ).rejects.toThrow(TransientError);
});
test("fails transiently when the durable version branch cannot be checked", async () => {
  await expect(
    assertNoPendingVersionBump(async () => commandResult(1, "", "network")),
  ).rejects.toThrow(TransientError);
});
test("blocks admission when live main has a divergent Temporal candidate", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: "2.0.0-42@sha256:candidate",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/prod/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/prod/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).rejects.toThrow(
    TransientError,
  );
  await expect(assertNoPendingVersionBump(executor, false)).resolves.toBe(
    catalog,
  );
});
test("allows the one-time central stable bootstrap transition", async () => {
  const legacy = `2.0.0-12197@sha256:${"a".repeat(64)}`;
  const stable = `2.0.0-12369@sha256:${"b".repeat(64)}`;
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: stable,
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: legacy,
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: stable,
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: stable,
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).resolves.toBe(
    catalog,
  );
});
test("allows admission when all live Temporal candidates match stable", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "ls-remote" || command[1] === "fetch"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).resolves.toBe(
    catalog,
  );
  await expect(assertNoPendingVersionBump(executor)).resolves.toBe(catalog);
});
test("rejects admission when a live Temporal workflow pin is missing", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).rejects.toThrow(
    "missing Temporal workflow pins",
  );
});
test("fails transiently when origin main cannot be refreshed", async () => {
  await expect(
    assertTemporalCandidatePinsConverged(async () => commandResult(1)),
  ).rejects.toThrow(TransientError);
});
test("fails transiently when the live version catalog cannot be read", async () => {
  await expect(
    assertTemporalCandidatePinsConverged(async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(1),
    ),
  ).rejects.toThrow(TransientError);
});
test("rejects malformed live version catalogs", async () => {
  const malformedCatalogs = [
    JSON.stringify({ entries: "invalid" }),
    JSON.stringify({ entries: ["invalid"] }),
  ];
  for (const catalog of malformedCatalogs) {
    const executor: CommandExecutor = async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(0, catalog);
    await expect(
      assertTemporalCandidatePinsConverged(executor),
    ).rejects.toThrow(Error);
  }
});
test("retains a central Workflow candidate until its pin converges with stable", () => {
  const digest = `sha256:${"b".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/temporal-worker": digest },
      "44",
      versionCatalogSource([
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: `2.0.0-43@sha256:${"c".repeat(64)}`,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: `2.0.0-42@sha256:${"d".repeat(64)}`,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": {
      version: "2.0.0-44",
      digest,
    },
  });
});
test("does not publish nonexistent Scout Workflow catalog pins", () => {
  const digest = `sha256:${"b".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/scout-for-lol/beta": digest },
      "43",
      versionCatalogSource([]),
    ),
  ).toEqual({
    "shepherdjerred/scout-for-lol/beta": {
      version: "2.0.0-43",
      digest,
    },
  });
});
test("does not synthesize a Scout Workflow candidate while its pins are absent", () => {
  const digest = `sha256:${"b".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/scout-for-lol/beta": digest },
      "44",
      versionCatalogSource([]),
    ),
  ).toEqual({
    "shepherdjerred/scout-for-lol/beta": {
      version: "2.0.0-44",
      digest,
    },
  });
});
function versionCatalogSource(
  entries: readonly { readonly name: string; readonly value: string }[],
): string {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: entries.map((entry) => ({
      name: entry.name,
      category: "internal-image",
      artifactType: "image",
      management: { managed: false },
      value: entry.value,
    })),
  });
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
  return commandResult(
    1,
    "",
    `ghcr.io/example@sha256:${"a".repeat(64)}: not found`,
  );
}
async function manifestUnknownInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1, "", "MANIFEST_UNKNOWN: manifest unknown");
}
async function httpNotFoundInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    1,
    "",
    "unexpected status from HEAD request: 404 Not Found",
  );
}
async function rateLimitedInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1, "", "429 Too Many Requests");
}
async function credentialErrorInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    1,
    "",
    "error getting credentials: docker-credential-desktop: executable file not found in $PATH",
  );
}
async function unclassifiedInspectExecutor(): Promise<BuildxCommandResult> {
  return commandResult(1, "", "unauthorized: authentication required");
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

async function validSourceLabelExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    0,
    JSON.stringify({
      "org.opencontainers.image.source":
        "https://github.com/shepherdjerred/monorepo",
    }),
  );
}

async function wrongSourceLabelExecutor(): Promise<BuildxCommandResult> {
  return commandResult(
    0,
    JSON.stringify({
      "org.opencontainers.image.source": "https://github.com/other/repo",
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

test("resolves Bake with the production image environment", () => {
  expect(
    productionBakeEnvironment(
      {
        KEEP: "value",
        PUSH_CACHE: "false",
        PUSH_IMAGES: "false",
        VERSION: "dev",
      },
      {
        version: "42",
        gitSha: "commit",
        contractHash: "contract",
      },
    ),
  ).toEqual({
    KEEP: "value",
    VERSION: "42",
    GIT_SHA: "commit",
    CONTRACT_HASH: "contract",
    PUSH_CACHE: "true",
    PUSH_IMAGES: "true",
  });
});

test("waits for an exact digest to become anonymously pullable", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const requests: string[] = [];
  let tokenRequests = 0;
  let manifestRequests = 0;
  const fetcher = Object.assign(
    async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push(url);
      if (url.includes("/token?")) {
        tokenRequests += 1;
        return tokenRequests === 1
          ? new Response(null, { status: 401 })
          : Response.json({ token: "anonymous-token" });
      }
      manifestRequests += 1;
      return manifestRequests === 1
        ? new Response(null, { status: 404 })
        : new Response("{}", { status: 200 });
    },
    { preconnect: fetch.preconnect },
  );
  const sleeps: number[] = [];

  await ensureAnonymousGhcrPull("alert-dashboard", digest, {
    fetcher,
    sleeper: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    attempts: 3,
    delayMilliseconds: 25,
  });

  expect(sleeps).toEqual([25, 25]);
  expect(requests).toEqual([
    "https://ghcr.io/token?scope=repository%3Ashepherdjerred%2Falert-dashboard%3Apull&service=ghcr.io",
    "https://ghcr.io/token?scope=repository%3Ashepherdjerred%2Falert-dashboard%3Apull&service=ghcr.io",
    `https://ghcr.io/v2/shepherdjerred/alert-dashboard/manifests/${encodeURIComponent(digest)}`,
    "https://ghcr.io/token?scope=repository%3Ashepherdjerred%2Falert-dashboard%3Apull&service=ghcr.io",
    `https://ghcr.io/v2/shepherdjerred/alert-dashboard/manifests/${encodeURIComponent(digest)}`,
  ]);
});

test("fails closed when a GHCR package stays private", async () => {
  const fetcher = Object.assign(
    async () => new Response(null, { status: 401 }),
    { preconnect: fetch.preconnect },
  );

  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"b".repeat(64)}`, {
      fetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 2,
      delayMilliseconds: 0,
    }),
  ).rejects.toThrow(
    "GHCR package shepherdjerred/alert-dashboard is not anonymously pullable",
  );
  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"b".repeat(64)}`, {
      fetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 1,
    }),
  ).rejects.not.toBeInstanceOf(TransientError);
});

test("preserves exhausted GHCR transport and server failures as transient", async () => {
  for (const status of [408, 429, 500, 503]) {
    const fetcher = Object.assign(async () => new Response(null, { status }), {
      preconnect: fetch.preconnect,
    });
    await expect(
      ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"c".repeat(64)}`, {
        fetcher,
        sleeper: async (milliseconds) => milliseconds,
        attempts: 1,
      }),
    ).rejects.toBeInstanceOf(TransientError);
  }

  const fetcher = Object.assign(
    async () => {
      throw new Error("request timed out");
    },
    { preconnect: fetch.preconnect },
  );
  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"d".repeat(64)}`, {
      fetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 1,
    }),
  ).rejects.toBeInstanceOf(TransientError);

  let request = 0;
  const propagatingManifestFetcher = Object.assign(
    async () => {
      request += 1;
      return request % 2 === 1
        ? Response.json({ token: "anonymous-token" })
        : new Response(null, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  );
  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"e".repeat(64)}`, {
      fetcher: propagatingManifestFetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 1,
    }),
  ).rejects.toBeInstanceOf(TransientError);

  const invalidTokenFetcher = Object.assign(
    async () => new Response("truncated-token-json", { status: 200 }),
    { preconnect: fetch.preconnect },
  );
  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"e".repeat(64)}`, {
      fetcher: invalidTokenFetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 1,
    }),
  ).rejects.toBeInstanceOf(TransientError);

  class TruncatedManifestResponse extends Response {
    override arrayBuffer = async (): Promise<ArrayBuffer> => {
      throw new Error("manifest connection closed");
    };
  }
  let bodyRequests = 0;
  const truncatedManifestFetcher = Object.assign(
    async () => {
      bodyRequests += 1;
      return bodyRequests === 1
        ? Response.json({ token: "anonymous-token" })
        : new TruncatedManifestResponse("partial", { status: 200 });
    },
    { preconnect: fetch.preconnect },
  );
  await expect(
    ensureAnonymousGhcrPull("alert-dashboard", `sha256:${"f".repeat(64)}`, {
      fetcher: truncatedManifestFetcher,
      sleeper: async (milliseconds) => milliseconds,
      attempts: 1,
    }),
  ).rejects.toBeInstanceOf(TransientError);
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
      versionCatalogSource([
        {
          name: "shepherdjerred/example/prod",
          value: `2.0.0-1@${prodDigest}`,
        },
        {
          name: "shepherdjerred/example/beta",
          value: `2.0.0-2@${betaDigest}`,
        },
      ]),
      "example",
    ),
  ).toEqual({
    key: "shepherdjerred/example/beta",
    digest: betaDigest,
  });
  expect(
    findManagedImagePin(
      versionCatalogSource([
        {
          name: "shepherdjerred/unrelated",
          value: `2.0.0-1@${prodDigest}`,
        },
      ]),
      "example",
    ),
  ).toBeUndefined();
});

test("fails closed on malformed or ambiguous structured catalogs", () => {
  expect(() => findManagedImagePin("{", "example")).toThrow(
    "version catalog is not valid JSON",
  );

  const digest = `sha256:${"a".repeat(64)}`;
  const duplicateCatalog = versionCatalogSource([
    {
      name: "shepherdjerred/example",
      value: `2.0.0-1@${digest}`,
    },
    {
      name: "shepherdjerred/example",
      value: `2.0.0-2@${digest}`,
    },
  ]);
  expect(() => findManagedImagePin(duplicateCatalog, "example")).toThrow(
    "version catalog names must be unique",
  );
});

test("resolves every bake target from the real structured version catalog", async () => {
  const catalog = await Bun.file(VERSION_CATALOG_URL).text();
  const missingPins = expandTargets(knownImageTargets).filter(
    (target) => findManagedImagePin(catalog, target) === undefined,
  );

  expect(missingPins).toEqual([]);
});

test("shares its full-build target universe with the image selector", () => {
  expect(knownImageTargets).toEqual(ALL_IMAGE_TARGETS);
  expect(knownImageTargets).toContain("openrouter-broadcast-ingest");
});

test("validates structured pins before starting a production push", async () => {
  const commands: string[][] = [];
  const digest = `sha256:${"a".repeat(64)}`;

  await expect(
    pushImages(
      {
        targets: ["birmel"],
        commit: "commit",
        buildNumber: "42",
        contractHash: "contract",
      },
      {
        executor: async (command) => {
          commands.push([...command]);
          return commandResult();
        },
        environment: {},
        readVersionCatalog: async () =>
          versionCatalogSource([
            {
              name: "shepherdjerred/unrelated",
              value: `2.0.0-1@${digest}`,
            },
          ]),
      },
    ),
  ).rejects.toThrow(
    "No managed image pin exists for ghcr.io/shepherdjerred/birmel",
  );
  expect(commands).toEqual([]);
});

test("runs the default application candidate smoke check", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const commands: string[][] = [];
  await pushImages(
    {
      targets: ["birmel"],
      commit: "commit",
      buildNumber: "42",
      contractHash: "contract",
    },
    {
      executor: async (command) => {
        commands.push([...command]);
        return commandResult();
      },
      environment: {},
      getManifestDigest: async () => digest,
      verifyAnonymousPull: () => Promise.resolve(),
      verifySourceLabel: () => Promise.resolve(),
      getRuntimeFingerprint: async () => "new",
      writeMetadata: () => Promise.resolve(),
      writeCandidates: () => Promise.resolve(),
      writeText: () => Promise.resolve(),
    },
  );
  expect(commands.some((command) => command.includes("--file"))).toBe(true);
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
  expect(
    parseLastPassedStepsCommit(
      [
        {
          commit: "current",
          jobs: [
            { step_key: "images", state: "passed" },
            { step_key: "version-commit-back", state: "running" },
          ],
        },
        {
          commit: "previous",
          jobs: [
            { step_key: "images", state: "passed" },
            { step_key: "version-commit-back", state: "passed" },
          ],
        },
      ],
      ["images", "version-commit-back"],
    ),
  ).toBe("previous");
  expect(
    parseLastPassedStepsCommit([{ commit: "current", jobs: [] }], ["images"]),
  ).toBeUndefined();
  expect(() =>
    parseLastPassedStepsCommit([{ commit: "current" }], ["images"]),
  ).toThrow("contain jobs");
  expect(() => parseLastPassedStepsCommit({}, ["images"])).toThrow("array");
  expect(() => parseLastPassedStepsCommit([{ jobs: [] }], ["images"])).toThrow(
    "contain a commit",
  );
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

test("resolves the newest main commit whose image release jobs passed", async () => {
  const fetcher = Object.assign(
    async () =>
      Response.json(
        [
          {
            commit: "current",
            jobs: [
              { step_key: "images", state: "passed" },
              { step_key: "version-commit-back", state: "running" },
            ],
          },
          {
            commit: "image-green-commit",
            jobs: [
              { step_key: "images", state: "passed" },
              { step_key: "version-commit-back", state: "passed" },
            ],
          },
        ],
        { status: 200 },
      ),
    { preconnect: fetch.preconnect },
  );
  const commands: string[][] = [];
  const executor: CommandExecutor = async (command) => {
    commands.push([...command]);
    return commandResult();
  };

  expect(
    await lastSuccessfulImageReleaseCommit("current", fetcher, executor, {
      BUILDKITE_READ_TOKEN: "token",
    }),
  ).toBe("image-green-commit");
  expect(commands).toEqual([
    ["git", "cat-file", "-e", "image-green-commit^{commit}"],
    ["git", "merge-base", "--is-ancestor", "image-green-commit", "current"],
  ]);
  expect(
    await lastSuccessfulImageReleaseCommit("current", fetcher, executor, {}),
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

test("uses the last completed image-release commit for scoped pushes", async () => {
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
  // A bare, unclassified inspect failure (no recognized signature) must fail
  // loud rather than masquerade as an unresolvable image.
  await expect(
    imageRuntimeFingerprint("example:tag", failingExecutor),
  ).rejects.toThrow("Unclassified failure inspecting example:tag");
  expect(() => runtimeFingerprintFromImage({})).toThrow(
    "architecture, os, and rootfs",
  );
});

test("validates optional OCI runtime metadata", () => {
  const base = {
    architecture: "amd64",
    os: "linux",
    rootfs: { type: "layers", diff_ids: ["sha256:one"] },
    config: {},
  };
  expect(() => runtimeFingerprintFromImage(null)).toThrow(
    "image metadata must be an object",
  );
  expect(() => runtimeFingerprintFromImage({ ...base, config: null })).toThrow(
    "image runtime config must be an object",
  );
  expect(() =>
    runtimeFingerprintFromImage({
      ...base,
      rootfs: { diff_ids: ["sha256:one"] },
    }),
  ).toThrow("image rootfs must contain a type");
  expect(() =>
    runtimeFingerprintFromImage({ ...base, "os.version": 1 }),
  ).toThrow("image os.version must be a string");
  expect(
    runtimeFingerprintFromImage({
      ...base,
      "os.features": ["feature-one"],
      config: { enabled: true, retries: 3, optional: null },
    }),
  ).toMatch(/^[a-f\d]{64}$/u);
});

test("requires the effective candidate OCI source label", async () => {
  const image = `ghcr.io/shepherdjerred/example@sha256:${"a".repeat(64)}`;
  await expect(
    assertImageSourceLabel(image, validSourceLabelExecutor),
  ).resolves.toBeUndefined();
  await expect(
    assertImageSourceLabel(image, wrongSourceLabelExecutor),
  ).rejects.toThrow("must carry org.opencontainers.image.source");
  await expect(
    assertImageSourceLabel(image, async () => commandResult(0, "{")),
  ).rejects.toBeInstanceOf(TransientError);
  await expect(
    assertImageSourceLabel(image, transientInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);
  await expect(
    assertImageSourceLabel(image, manifestUnknownInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);
  await expect(
    assertImageSourceLabel(image, httpNotFoundInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);
  await expect(
    assertImageSourceLabel(
      "ghcr.io/shepherdjerred/example:missing",
      httpNotFoundInspectExecutor,
    ),
  ).rejects.not.toBeInstanceOf(TransientError);
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

test("classifies inspect failures as transient, missing, or unclassified", async () => {
  const image = `ghcr.io/example@sha256:${"a".repeat(64)}`;
  // A transient registry/BuildKit failure must be preserved as a retryable
  // TransientError, not silently misclassified as an unresolvable image.
  await expect(
    imageRuntimeFingerprint(image, transientInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);

  // Registry rate limiting (429 / TOOMANYREQUESTS) is transient too.
  await expect(
    imageRuntimeFingerprint(image, rateLimitedInspectExecutor),
  ).rejects.toBeInstanceOf(TransientError);

  // A genuine missing manifest — tied to the requested digest, or a registry
  // MANIFEST_UNKNOWN code — remains `undefined` (the legitimate pin-unresolvable
  // signal).
  expect(
    await imageRuntimeFingerprint(image, notFoundInspectExecutor),
  ).toBeUndefined();
  expect(
    await imageRuntimeFingerprint(image, manifestUnknownInspectExecutor),
  ).toBeUndefined();

  // A "not found" that is NOT tied to the manifest (e.g. a missing credential
  // helper executable) is unclassified and must fail loud, not masquerade as an
  // unresolvable pin.
  await expect(
    imageRuntimeFingerprint(image, credentialErrorInspectExecutor),
  ).rejects.toThrow("Unclassified failure inspecting");

  // Any other unclassified failure fails loud as a plain Error (not a
  // TransientError, not `undefined`), so it never promotes against an
  // unreadable pin.
  let caught: unknown;
  try {
    await imageRuntimeFingerprint(image, unclassifiedInspectExecutor);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(TransientError);
  expect(String(caught)).toContain("Unclassified failure inspecting");
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
  const catalog = versionCatalogSource([
    {
      name: "shepherdjerred/birmel",
      value: `2.0.0-1@${pinned}`,
    },
    {
      name: "shepherdjerred/scout-for-lol/beta",
      value: `2.0.0-2@${pinned}`,
    },
    {
      name: "shepherdjerred/scout-for-lol/prod",
      value: `2.0.0-1@${pinned}`,
    },
    {
      name: "shepherdjerred/starlight-karma-bot/beta",
      value: `2.0.0-2@${pinned}`,
    },
    {
      name: "shepherdjerred/starlight-karma-bot/prod",
      value: `2.0.0-1@${pinned}`,
    },
  ]);
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
      readVersionCatalog: async () => catalog,
      getManifestDigest: async (image) => {
        manifestReferences.push(image);
        events.push(`resolve:${image}`);
        return digest;
      },
      verifyAnonymousPull: async (target, reference) => {
        events.push(`public:${target}:${reference}`);
      },
      verifySourceLabel: async (image) => {
        events.push(`source:${image}`);
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
  expect(events.filter((event) => event.startsWith("public:"))).toEqual([
    `public:birmel:${digest}`,
    `public:scout-for-lol:${digest}`,
    `public:starlight-karma-bot:${digest}`,
  ]);
  expect(events.filter((event) => event.startsWith("source:"))).toEqual([
    `source:ghcr.io/shepherdjerred/birmel@${digest}`,
    `source:ghcr.io/shepherdjerred/scout-for-lol@${digest}`,
    `source:ghcr.io/shepherdjerred/starlight-karma-bot@${digest}`,
  ]);
  expect(events[0]).toBe(
    "resolve:ghcr.io/shepherdjerred/birmel:candidate-commit",
  );
  expect(events[1]).toBe(`public:birmel:${digest}`);
  expect(events[2]).toBe(`source:ghcr.io/shepherdjerred/birmel@${digest}`);
  expect(events[3]).toBe(
    `smoke:birmel:ghcr.io/shepherdjerred/birmel@${digest}`,
  );
  expect(events[4]).toBe(`fingerprint:ghcr.io/shepherdjerred/birmel@${digest}`);
  expect(
    events.indexOf(
      "resolve:ghcr.io/shepherdjerred/scout-for-lol:candidate-commit",
    ),
  ).toBeLessThan(events.indexOf(`public:scout-for-lol:${digest}`));
  expect(events.indexOf(`public:scout-for-lol:${digest}`)).toBeLessThan(
    events.indexOf(`source:ghcr.io/shepherdjerred/scout-for-lol@${digest}`),
  );
  expect(
    events.indexOf(`source:ghcr.io/shepherdjerred/scout-for-lol@${digest}`),
  ).toBeLessThan(
    events.indexOf(
      `smoke:scout-for-lol:ghcr.io/shepherdjerred/scout-for-lol@${digest}`,
    ),
  );
  expect(
    events.indexOf(
      "resolve:ghcr.io/shepherdjerred/starlight-karma-bot:candidate-commit",
    ),
  ).toBeLessThan(events.indexOf(`public:starlight-karma-bot:${digest}`));
  expect(events.indexOf(`public:starlight-karma-bot:${digest}`)).toBeLessThan(
    events.indexOf(
      `source:ghcr.io/shepherdjerred/starlight-karma-bot@${digest}`,
    ),
  );
  expect(
    events.indexOf(
      `source:ghcr.io/shepherdjerred/starlight-karma-bot@${digest}`,
    ),
  ).toBeLessThan(
    events.indexOf(
      `fingerprint:ghcr.io/shepherdjerred/starlight-karma-bot@${digest}`,
    ),
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

test("keeps an exact candidate fingerprint propagation miss transient", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const pinned = `sha256:${"a".repeat(64)}`;
  const events: string[] = [];
  const missingFingerprint = new Map<string, string>().get("candidate");

  await expect(
    pushImages(
      {
        targets: ["birmel"],
        commit: "commit",
        buildNumber: "42",
        contractHash: "contract",
      },
      {
        executor: async () => commandResult(),
        environment: {},
        readVersionCatalog: async () =>
          versionCatalogSource([
            {
              name: "shepherdjerred/birmel",
              value: `2.0.0-1@${pinned}`,
            },
          ]),
        getManifestDigest: async () => digest,
        verifyAnonymousPull: async () => {
          events.push("public");
        },
        verifySourceLabel: async () => {
          events.push("source");
        },
        smokeCandidate: async () => {
          events.push("smoke");
        },
        getRuntimeFingerprint: async () => missingFingerprint,
      },
    ),
  ).rejects.toBeInstanceOf(TransientError);
  expect(events).toEqual(["public", "source", "smoke"]);
});

test("keeps upstream provenance for infrastructure images", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const pinned = `sha256:${"a".repeat(64)}`;
  const sourceChecks: string[] = [];
  const events: string[] = [];
  await pushImages(
    {
      targets: ["redlib"],
      commit: "commit",
      buildNumber: "42",
      contractHash: "contract",
    },
    {
      executor: async () => commandResult(),
      environment: {},
      readVersionCatalog: async () =>
        versionCatalogSource([
          {
            name: "shepherdjerred/redlib",
            value: `2.0.0-1@${pinned}`,
          },
        ]),
      getManifestDigest: async () => digest,
      verifyAnonymousPull: async () => {
        events.push("public");
      },
      verifySourceLabel: async (image) => {
        sourceChecks.push(image);
      },
      getRuntimeFingerprint: async () => "same",
      writeMetadata: async () => {
        events.push("metadata");
      },
      writeCandidates: async () => {
        events.push("candidates");
      },
      writeText: async () => {
        events.push("outcomes");
      },
    },
  );
  expect(sourceChecks).toEqual([]);
  expect(events).toEqual(["public", "metadata", "candidates", "outcomes"]);
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
