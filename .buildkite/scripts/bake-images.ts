import { rm } from "node:fs/promises";
import { asRecord } from "../../scripts/lib/json.ts";
import { writeJsonHandoff } from "./buildkite-handoff.ts";
import {
  classifyRuntimeChange,
  imageRuntimeFingerprint,
  runExactCandidateSmoke,
  sourceLabelVerifier,
} from "./application-image-runtime.ts";
import {
  retryTransientBuildx,
  type BuildxCommandResult,
} from "./bake-retry.ts";
import {
  caddyfileEntitlementArguments,
  expandTargets,
  fixedCorpusMode,
  knownImageTargets,
  parseBakeArguments,
  parseLastPassedStepsCommit,
  parseImageSelection,
} from "./migration-core.ts";
import { resolveManagedImagePins } from "../../scripts/lib/image-pin-catalog.ts";
import { APPLICATION_IMAGE_TARGETS } from "./image-targets.ts";
import {
  anonymousPullVerifier,
  type AnonymousPullVerifier,
} from "./ghcr-public-access.ts";
import type { PushOptions, PushOutcome } from "./bake-image-push-types.ts";
import { productionBakeEnvironment } from "./production-bake-environment.ts";
import { runMain } from "../../scripts/lib/transient.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";
import { pinCandidatesForDigests } from "./pin-candidate-images.ts";

const registry = "ghcr.io/shepherdjerred";
const selectionReport = "image-selection-report.json";
const pushOutcomes = "image-push-outcomes.json";
const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const TEMPORAL_WORKFLOW_PIN_PAIRS = [
  [
    "shepherdjerred/temporal-worker/workflows/stable",
    "shepherdjerred/temporal-worker/workflows/candidate",
  ],
  [
    "shepherdjerred/scout-for-lol/beta/workflows/stable",
    "shepherdjerred/scout-for-lol/beta/workflows/candidate",
  ],
] as const;
type TemporalWorkflowPinPair = (typeof TEMPORAL_WORKFLOW_PIN_PAIRS)[number];
export const VERSION_CATALOG_URL = new URL(
  "../../packages/version-catalog/src/catalog.json",
  import.meta.url,
);
const applicationImageTargets = new Set(APPLICATION_IMAGE_TARGETS);

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

/**
 * Candidate admission is serialized with the version commit-back step, but
 * that step opens an auto-merge PR and can finish before GitHub merges it.
 * Refuse to publish another candidate while that durable pin branch exists;
 * the retry will re-read origin after the catalog PR has landed.
 */
export async function assertNoPendingVersionBump(
  executor: CommandExecutor = execute,
  pinPairs: readonly TemporalWorkflowPinPair[] = TEMPORAL_WORKFLOW_PIN_PAIRS,
): Promise<void> {
  const result = await executor([
    "git",
    "ls-remote",
    "origin",
    `refs/heads/${VERSION_BUMP_BRANCH}`,
  ]);
  if (result.exitCode !== 0) {
    throw new TransientError(
      `Unable to check ${VERSION_BUMP_BRANCH} before candidate admission`,
    );
  }
  if (result.stdout.trim() !== "") {
    throw new TransientError(
      `${VERSION_BUMP_BRANCH} is still pending; retry after its catalog update merges`,
    );
  }
  await assertTemporalCandidatePinsConverged(executor, pinPairs);
}

/**
 * A merged version-bump PR removes the branch before every Buildkite checkout
 * observes the new main commit. Read the live catalog after fetching main so a
 * stale checkout cannot replace a candidate that is already being ramped.
 */
export async function assertTemporalCandidatePinsConverged(
  executor: CommandExecutor = execute,
  pinPairs: readonly TemporalWorkflowPinPair[] = TEMPORAL_WORKFLOW_PIN_PAIRS,
): Promise<void> {
  const fetched = await executor(["git", "fetch", "origin", "main"]);
  if (fetched.exitCode !== 0) {
    throw new TransientError(
      "Unable to refresh origin/main before Temporal candidate admission",
    );
  }
  const catalog = await executor([
    "git",
    "show",
    `origin/main:${VERSION_CATALOG_PATH}`,
  ]);
  if (catalog.exitCode !== 0) {
    throw new TransientError(
      "Unable to read the live version catalog before Temporal candidate admission",
    );
  }
  const parsed = asRecord(JSON.parse(catalog.stdout));
  if (parsed === null || !Array.isArray(parsed.entries)) {
    throw new Error("Live version catalog has an invalid shape");
  }
  const values = new Map<string, string>();
  for (const entryValue of parsed.entries) {
    const entry = asRecord(entryValue);
    if (
      entry === null ||
      typeof entry.name !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new Error("Live version catalog has an invalid entry");
    }
    values.set(entry.name, entry.value);
  }
  for (const [stable, candidate] of pinPairs) {
    const stableValue = values.get(stable);
    const candidateValue = values.get(candidate);
    if (stableValue === undefined || candidateValue === undefined) {
      throw new Error(
        `Version catalog is missing Temporal workflow pins for ${stable}`,
      );
    }
    if (stableValue !== candidateValue) {
      throw new TransientError(
        `Temporal candidate ${candidate} is active in origin/main; wait for its ramp or promotion before publishing another candidate`,
      );
    }
  }
}

/**
 * Resolve the newest main commit with completed image and pin-handoff evidence.
 * The overall build may be canceled after version commit-back advances main;
 * these two passed jobs still prove that the selected closures were built,
 * smoked, pushed, and handed to the durable pin workflow successfully.
 */
export async function lastSuccessfulImageReleaseCommit(
  currentCommit: string,
  fetcher: typeof fetch = fetch,
  executor: CommandExecutor = execute,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string | undefined> {
  const token = environment["BUILDKITE_READ_TOKEN"];
  if (token === undefined) return undefined;
  const response = await fetcher(
    "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds?branch=main&per_page=20&include_retried_jobs=true",
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);
  if (response?.ok !== true) return undefined;
  const commit = parseLastPassedStepsCommit(await response.json(), [
    "images",
    "version-commit-back",
  ]);
  if (commit === undefined) return undefined;
  for (const command of [
    ["git", "cat-file", "-e", `${commit}^{commit}`],
    ["git", "merge-base", "--is-ancestor", commit, currentCommit],
  ]) {
    const validation = await executor(command);
    if (validation.exitCode !== 0) return undefined;
  }
  return commit;
}

export async function selectedTargets(
  options: {
    readonly affected: boolean;
    readonly push: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  commit: string,
  executor: CommandExecutor = execute,
  imageBaseCommit: (
    currentCommit: string,
  ) => Promise<string | undefined> = lastSuccessfulImageReleaseCommit,
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
    base = await imageBaseCommit(commit);
    if (base === undefined)
      fallbackReason = "could not resolve last completed main image release";
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

async function setDigestMetadata(
  digests: Readonly<Record<string, string>>,
): Promise<void> {
  await writeJsonHandoff("image-digests", "image-digests.json", digests);
}

async function setPinCandidatesMetadata(
  digests: Readonly<Record<string, string>>,
  buildNumber: string,
): Promise<void> {
  const parsedBuildNumber = Number(buildNumber);
  if (!Number.isSafeInteger(parsedBuildNumber) || parsedBuildNumber <= 0) {
    throw new Error("Build number must be a positive safe integer");
  }
  const versionCatalogSource = await Bun.file(VERSION_CATALOG_URL).text();
  const candidates = pinCandidatesForDigests(
    digests,
    buildNumber,
    versionCatalogSource,
  );
  await writeJsonHandoff("pin-candidates", "pin-candidates.json", {
    schema: "pin-candidates/v1",
    buildNumber: parsedBuildNumber,
    candidates,
  });
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

export async function pushImages(
  options: PushOptions,
  dependencies: {
    readonly executor?: CommandExecutor;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly readVersionCatalog?: () => Promise<string>;
    readonly getManifestDigest?: (image: string) => Promise<string>;
    readonly verifyAnonymousPull?: AnonymousPullVerifier;
    readonly verifySourceLabel?: (image: string) => Promise<void>;
    readonly getRuntimeFingerprint?: (
      image: string,
    ) => Promise<string | undefined>;
    readonly smokeCandidate?: (
      target: string,
      candidate: string,
      contractHash: string,
    ) => Promise<void>;
    readonly writeMetadata?: (
      digests: Readonly<Record<string, string>>,
    ) => Promise<void>;
    readonly writeCandidates?: (
      digests: Readonly<Record<string, string>>,
      buildNumber: string,
    ) => Promise<void>;
    readonly writeText?: TextWriter;
  } = {},
): Promise<void> {
  const { targets, commit, buildNumber, contractHash } = options;
  const executor = dependencies.executor ?? execute;
  const environment = dependencies.environment ?? Bun.env;
  const readVersionCatalog =
    dependencies.readVersionCatalog ??
    (async () => Bun.file(VERSION_CATALOG_URL).text());
  const getManifestDigest = dependencies.getManifestDigest ?? manifestDigest;
  const verifyAnonymousPull = anonymousPullVerifier(
    dependencies.verifyAnonymousPull,
  );
  const verifySourceLabel = sourceLabelVerifier(
    dependencies.verifySourceLabel,
    executor,
  );
  const getRuntimeFingerprint =
    dependencies.getRuntimeFingerprint ??
    (async (image) => imageRuntimeFingerprint(image, executor));
  const smokeCandidate =
    dependencies.smokeCandidate ??
    (async (target, candidate, expectedContractHash) =>
      runExactCandidateSmoke(
        {
          target,
          candidate,
          contractHash: expectedContractHash,
        },
        executor,
        environment,
      ));
  const writeMetadata = dependencies.writeMetadata ?? setDigestMetadata;
  const writeCandidates =
    dependencies.writeCandidates ?? setPinCandidatesMetadata;
  const writeText = dependencies.writeText ?? Bun.write;
  const versionCatalog = await readVersionCatalog();
  const targetsWithPins = resolveManagedImagePins(versionCatalog, targets);
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
      productionBakeEnvironment(environment, {
        version: buildNumber,
        gitSha: commit,
        contractHash,
      }),
    ),
  );
  if (pushExitCode === 34) process.exit(pushExitCode);
  if (pushExitCode !== 0) throw new Error("Production image push failed");

  const digests: Record<string, string> = {};
  const outcomes: PushOutcome[] = [];
  for (const { name, pin: managedPin } of targetsWithPins) {
    const image = `${registry}/${name}`;
    const candidateTag = `${image}:candidate-${commit}`;
    const digest = await getManifestDigest(candidateTag);
    const candidate = `${image}@${digest}`;
    await verifyAnonymousPull(name, digest);
    if (applicationImageTargets.has(name)) {
      await verifySourceLabel(candidate);
      await smokeCandidate(name, candidate, contractHash);
    }
    const newFingerprint = await getRuntimeFingerprint(candidate);
    if (newFingerprint === undefined)
      throw new TransientError(`Candidate unavailable: ${candidate}`);
    const outcome = await classifyRuntimeChange(
      {
        image,
        pinnedDigest: managedPin.digest,
        candidateFingerprint: newFingerprint,
      },
      getRuntimeFingerprint,
    );
    outcomes.push({ image: name, outcome });
    if (outcome === "content-unchanged") continue;
    if (name === "starlight-karma-bot") {
      const tag = await executor([
        "docker",
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image}:2.0.0-${buildNumber}`,
        candidate,
      ]);
      if (tag.exitCode !== 0) throw new Error(`Version tag failed for ${name}`);
    }
    digests[managedPin.key] = digest;
  }
  await writeMetadata(digests);
  await writeCandidates(digests, buildNumber);
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

async function main(): Promise<void> {
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
      await setPinCandidatesMetadata({}, buildNumber);
      await Bun.write(pushOutcomes, "[]\n");
    }
    return;
  }

  if (
    options.push &&
    (bakeTargets.includes("temporal-worker") ||
      bakeTargets.includes("scout-for-lol"))
  ) {
    const pinPairs = [
      ...(bakeTargets.includes("temporal-worker")
        ? [TEMPORAL_WORKFLOW_PIN_PAIRS[0]]
        : []),
      ...(bakeTargets.includes("scout-for-lol")
        ? [TEMPORAL_WORKFLOW_PIN_PAIRS[1]]
        : []),
    ];
    await assertNoPendingVersionBump(execute, pinPairs);
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

if (import.meta.main) await runMain(main);
