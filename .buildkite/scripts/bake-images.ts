import { rm } from "node:fs/promises";
import { asRecord } from "../../scripts/lib/json.ts";
import {
  retryTransientBuildx,
  type BuildxCommandResult,
} from "./bake-retry.ts";
import {
  caddyfileEntitlementArguments,
  expandTargets,
  findPinnedDigest,
  fixedCorpusMode,
  knownImageTargets,
  parseBakeArguments,
  parseBuildkiteCommits,
  parseImageSelection,
  parseStringArray,
} from "./migration-core.ts";

const registry = "ghcr.io/shepherdjerred";
const selectionReport = "image-selection-report.json";
const pushOutcomes = "image-push-outcomes.json";
const versionsPath = "packages/homelab/src/cdk8s/src/versions.ts";

export type CommandExecutor = (
  command: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
) => Promise<BuildxCommandResult>;

export type TextWriter = (path: string, contents: string) => Promise<unknown>;

export async function execute(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<BuildxCommandResult> {
  const child = Bun.spawn([...command], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stdout.length > 0) await Bun.stdout.write(stdout);
  if (stderr.length > 0) await Bun.stderr.write(stderr);
  return { exitCode, stdout, stderr };
}

export async function annotate(
  commandArguments: readonly string[],
  executor: CommandExecutor = execute,
): Promise<void> {
  const result = await executor([
    "bun",
    "--no-install",
    ".buildkite/scripts/annotate-image-summary.ts",
    ...commandArguments,
  ]);
  if (result.exitCode !== 0) {
    console.error("WARN: image summary annotation failed (non-fatal)");
  }
}

export async function lastGreenCommit(
  currentCommit: string,
  fetcher: typeof fetch = fetch,
  executor: CommandExecutor = execute,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string | undefined> {
  const token = environment["BUILDKITE_API_TOKEN"];
  if (token === undefined) return undefined;
  const response = await fetcher(
    "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds?branch=main&state=passed&per_page=1",
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);
  if (response?.ok !== true) return undefined;
  const commits = parseBuildkiteCommits(await response.json());
  const commit = commits[0];
  if (commit === undefined || commit === currentCommit) return undefined;
  const exists = await executor([
    "git",
    "cat-file",
    "-e",
    `${commit}^{commit}`,
  ]);
  return exists.exitCode === 0 ? commit : undefined;
}

export async function selectedTargets(
  options: {
    readonly affected: boolean;
    readonly push: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  commit: string,
  executor: CommandExecutor = execute,
  greenCommit: (
    currentCommit: string,
  ) => Promise<string | undefined> = lastGreenCommit,
): Promise<{ readonly targets: string[]; readonly fallbackReason: string }> {
  if (fixedCorpusMode(options.environment ?? Bun.env)) {
    return {
      targets: knownImageTargets,
      fallbackReason: "fixed CI I/O corpus requested",
    };
  }
  let base: string | undefined;
  let fallbackReason = "full build requested (no --affected/--push scoping)";
  if (options.affected) {
    const result = await executor(["git", "merge-base", "origin/main", "HEAD"]);
    if (result.exitCode === 0) base = result.stdout.trim();
    else fallbackReason = "could not resolve merge-base with origin/main";
  } else if (options.push) {
    base = await greenCommit(commit);
    if (base === undefined)
      fallbackReason = "could not resolve last green main build";
  }
  if (base === undefined) return { targets: knownImageTargets, fallbackReason };

  const selection = await executor([
    "bun",
    "--no-install",
    ".buildkite/scripts/select-image-targets.ts",
    "--base",
    base,
    "--reasons-out",
    selectionReport,
  ]);
  if (selection.exitCode !== 0) {
    return {
      targets: knownImageTargets,
      fallbackReason: "image selector failed",
    };
  }
  return parseImageSelection(selection.stdout);
}

export async function manifestDigest(
  image: string,
  executor: CommandExecutor = execute,
): Promise<string> {
  const result = await executor([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Manifest}}",
  ]);
  if (result.exitCode !== 0) throw new Error(`Could not inspect ${image}`);
  const manifest = asRecord(JSON.parse(result.stdout));
  const digest = manifest?.["digest"];
  if (typeof digest !== "string" || !/^sha256:[a-f\d]{64}$/.test(digest)) {
    throw new TypeError(`Invalid manifest digest for ${image}`);
  }
  return digest;
}

export async function imageLayers(
  image: string,
  executor: CommandExecutor = execute,
): Promise<string[] | undefined> {
  const result = await executor([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Image.RootFS.DiffIDs}}",
  ]);
  if (result.exitCode !== 0) return undefined;
  return parseStringArray(JSON.parse(result.stdout), "image layers");
}

async function setDigestMetadata(
  digests: Readonly<Record<string, string>>,
): Promise<void> {
  const metadata = Bun.spawn(
    ["buildkite-agent", "meta-data", "set", "image-digests"],
    {
      stdin: new Blob([JSON.stringify(digests)]),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await metadata.exited;
  if (exitCode !== 0) throw new Error("metadata write failed");
}

export async function ensureBuilder(
  executor: CommandExecutor = execute,
): Promise<void> {
  const inspect = await executor(["docker", "buildx", "inspect", "ci"]);
  if (inspect.exitCode === 0) return;
  const create = await executor([
    "docker",
    "buildx",
    "create",
    "--name",
    "ci",
    "--driver",
    "remote",
    "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
  ]);
  if (create.exitCode !== 0)
    throw new Error("Could not create BuildKit builder");
}

export async function runSmoke(
  bakeTargets: readonly string[],
  contractHash: string,
  executor: CommandExecutor = execute,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<void> {
  const smokeArguments = bakeTargets.flatMap((target) => [
    "--set",
    `${target}.target=smoke`,
  ]);
  smokeArguments.push(
    ...caddyfileEntitlementArguments(
      bakeTargets,
      environment["CADDYFILE_SMOKE_PATH"],
    ),
  );

  const exitCode = await retryTransientBuildx(() =>
    executor(
      [
        "docker",
        "buildx",
        "bake",
        "--builder",
        "ci",
        ...smokeArguments,
        ...bakeTargets,
      ],
      {
        ...environment,
        VERSION: "dev",
        GIT_SHA: "unknown",
        CONTRACT_HASH: contractHash,
        PUSH_CACHE: "false",
      },
    ),
  );
  if (exitCode !== 0) process.exit(exitCode);
}

type PushOutcome = {
  readonly image: string;
  readonly outcome:
    | "bumped"
    | "content-unchanged"
    | "pin-unresolvable-bumped"
    | "no-pin-bumped";
};

type PushOptions = {
  readonly targets: readonly string[];
  readonly commit: string;
  readonly buildNumber: string;
  readonly contractHash: string;
};

export async function pushImages(
  options: PushOptions,
  dependencies: {
    readonly executor?: CommandExecutor;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly readVersions?: () => Promise<string>;
    readonly getManifestDigest?: (image: string) => Promise<string>;
    readonly getImageLayers?: (image: string) => Promise<string[] | undefined>;
    readonly writeMetadata?: (
      digests: Readonly<Record<string, string>>,
    ) => Promise<void>;
    readonly writeText?: TextWriter;
  } = {},
): Promise<void> {
  const { targets, commit, buildNumber, contractHash } = options;
  const executor = dependencies.executor ?? execute;
  const environment = dependencies.environment ?? Bun.env;
  const readVersions =
    dependencies.readVersions ?? (async () => Bun.file(versionsPath).text());
  const getManifestDigest = dependencies.getManifestDigest ?? manifestDigest;
  const getImageLayers = dependencies.getImageLayers ?? imageLayers;
  const writeMetadata = dependencies.writeMetadata ?? setDigestMetadata;
  const writeText = dependencies.writeText ?? Bun.write;
  const caddyfileArguments = caddyfileEntitlementArguments(
    targets,
    environment["CADDYFILE_SMOKE_PATH"],
  );
  const pushExitCode = await retryTransientBuildx(() =>
    executor(
      [
        "docker",
        "buildx",
        "bake",
        "--builder",
        "ci",
        "--push",
        ...caddyfileArguments,
        ...targets,
      ],
      {
        ...environment,
        VERSION: buildNumber,
        GIT_SHA: commit,
        CONTRACT_HASH: contractHash,
        PUSH_CACHE: "true",
        PUSH_IMAGES: "true",
      },
    ),
  );
  if (pushExitCode === 34) process.exit(pushExitCode);
  if (pushExitCode !== 0) throw new Error("Production image push failed");

  const versions = await readVersions();
  const digests: Record<string, string> = {};
  const outcomes: PushOutcome[] = [];
  for (const name of targets) {
    const image = `${registry}/${name}`;
    const digest = await getManifestDigest(`${image}:${commit}`);
    const pinned = findPinnedDigest(versions, name);
    if (pinned === undefined) {
      outcomes.push({ image: name, outcome: "no-pin-bumped" });
    } else {
      const oldLayers = await getImageLayers(`${image}@${pinned}`);
      const newLayers = await getImageLayers(`${image}:${commit}`);
      if (
        oldLayers !== undefined &&
        newLayers !== undefined &&
        JSON.stringify(oldLayers) === JSON.stringify(newLayers)
      ) {
        outcomes.push({ image: name, outcome: "content-unchanged" });
        continue;
      }
      outcomes.push({
        image: name,
        outcome: oldLayers === undefined ? "pin-unresolvable-bumped" : "bumped",
      });
    }
    if (name === "starlight-karma-bot") {
      const tag = await executor([
        "docker",
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image}:2.0.0-${buildNumber}`,
        `${image}:${commit}`,
      ]);
      if (tag.exitCode !== 0) throw new Error(`Version tag failed for ${name}`);
    }
    digests[`shepherdjerred/${name}`] = digest;
  }
  await writeMetadata(digests);
  await writeText(pushOutcomes, `${JSON.stringify(outcomes)}\n`);
}

export async function writeFallbackReport(
  targets: readonly string[],
  reason: string,
  writeText: TextWriter = Bun.write,
): Promise<void> {
  const targetReasons = Object.fromEntries(
    targets.map((target) => [target, [reason]]),
  );
  await writeText(
    selectionReport,
    `${JSON.stringify({
      base: null,
      changedPaths: [],
      mode: "all",
      globalReason: reason,
      targets: targetReasons,
    })}\n`,
  );
}

if (import.meta.main) {
  const options = parseBakeArguments(Bun.argv.slice(2));
  const commit = Bun.env["BUILDKITE_COMMIT"];
  const buildNumber = Bun.env["BUILDKITE_BUILD_NUMBER"];
  if (commit === undefined || buildNumber === undefined) {
    throw new Error("BUILDKITE_COMMIT and BUILDKITE_BUILD_NUMBER are required");
  }
  await Promise.all([
    rm(selectionReport, { force: true }),
    rm(pushOutcomes, { force: true }),
  ]);

  const selection = await selectedTargets(options, commit);
  const bakeTargets = expandTargets(selection.targets);
  if (bakeTargets.length === 0) {
    console.log("no image-owning packages affected — nothing to build");
    await annotate(["--report", selectionReport]);
    if (options.push) {
      await setDigestMetadata({});
      await Bun.write(pushOutcomes, "[]\n");
    }
    process.exit(0);
  }

  await ensureBuilder();
  const contractHashResult = await execute([
    "bun",
    "--no-install",
    "packages/scout-for-lol/scripts/contract-hash.ts",
  ]);
  if (contractHashResult.exitCode !== 0)
    throw new Error("Contract hash generation failed");
  const contractHash = contractHashResult.stdout.trim();
  await runSmoke(bakeTargets, contractHash);
  if (options.push) {
    await pushImages({
      targets: bakeTargets,
      commit,
      buildNumber,
      contractHash,
    });
  }

  if (!(await Bun.file(selectionReport).exists())) {
    await writeFallbackReport(selection.targets, selection.fallbackReason);
  }
  const annotationArguments = ["--report", selectionReport];
  if (await Bun.file(pushOutcomes).exists()) {
    annotationArguments.push("--outcomes", pushOutcomes);
  }
  await annotate(annotationArguments);
}
