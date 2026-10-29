import { rm } from "node:fs/promises";
import { teeOutputTail } from "../reporting/command-output.ts";
import { asRecord } from "../../../scripts/lib/json.ts";
import { setDeliveryDigestMetadata } from "../../../scripts/lib/ci/image-publication-handoff.ts";
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
  parseImageSelection,
} from "../migration-core.ts";
import {
  CANONICAL_IMAGE_TARGETS,
  imageIdentity,
  unbuiltImageOriginals,
  type QualifiedImageInventory,
} from "../../../scripts/lib/image-pin-catalog.ts";
import {
  publicationOwners,
  type PublicationOwners,
} from "../../../packages/ops-model/src/delivery-catalog/publication-owners.ts";
import type { ArtifactVersion } from "../../../packages/delivery/src/shared/contract.ts";
import { APPLICATION_IMAGE_TARGETS } from "./image-targets.ts";
import {
  ensureDockerHubAccess,
  type RegistryAccessVerifier,
} from "./dockerhub-access.ts";
import type { PushOptions, PushOutcome } from "./bake-image-push-types.ts";
import { productionBakeEnvironment } from "./production-bake-environment.ts";
import { runMain } from "../../../scripts/lib/transient.ts";
import {
  lastSuccessfulImageReleaseCommit,
  readRetainableImages,
} from "./live-version-catalog.ts";
import { includeMissingQualifiedImages } from "../selectors/select-image-targets-pins.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";
import {
  writeFallbackReport,
  type TextWriter,
} from "./image-selection-report.ts";

const registry = "docker.io/shepherdjerred";
const selectionReport = "image-selection-report.json";
const pushOutcomes = "image-push-outcomes.json";
const applicationImageTargets = new Set(APPLICATION_IMAGE_TARGETS);

export type CommandExecutor = (
  command: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
) => Promise<BuildxCommandResult>;

export async function execute(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<BuildxCommandResult> {
  const child = Bun.spawn([...command], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const buildProgress =
    command[0] === "docker" && command[1] === "buildx" && command[2] === "bake";
  const [stdout, stderr, exitCode] = await Promise.all([
    buildProgress
      ? teeOutputTail(child.stdout, async (chunk) => Bun.stdout.write(chunk))
      : new Response(child.stdout).text(),
    buildProgress
      ? teeOutputTail(child.stderr, async (chunk) => Bun.stderr.write(chunk))
      : new Response(child.stderr).text(),
    child.exited,
  ]);
  // Machine-readable commands (selectors, manifests, catalogs) need their full
  // result. Only build progress is streamed and truncated for retry evidence.
  if (!buildProgress && stdout.length > 0) await Bun.stdout.write(stdout);
  if (!buildProgress && stderr.length > 0) await Bun.stderr.write(stderr);
  return { exitCode, stdout, stderr };
}

export async function annotate(
  commandArguments: readonly string[],
  executor: CommandExecutor = execute,
): Promise<void> {
  const result = await executor([
    "bun",
    "--no-install",
    "ci/scripts/reporting/annotate-image-summary.ts",
    ...commandArguments,
  ]);
  if (result.exitCode !== 0) {
    console.error("WARN: image summary annotation failed (non-fatal)");
  }
}

export async function selectedTargets(
  options: {
    readonly affected: boolean;
    readonly push: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
  commit: string,
  executor: CommandExecutor = execute,
  imageBaseCommit: (currentCommit: string) => Promise<string | undefined> = (
    current,
  ) => lastSuccessfulImageReleaseCommit(current, executor),
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
    "ci/scripts/selectors/select-image-targets.ts",
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

/** Push only recipes whose catalog owners admit new builds. */
export function publicationTargets(
  selected: readonly string[],
  originals: QualifiedImageInventory,
  owners: PublicationOwners,
): string[] {
  const eligible = CANONICAL_IMAGE_TARGETS.filter((name) =>
    owners.imageActive(name),
  );
  return expandTargets(
    includeMissingQualifiedImages(selected, originals, eligible),
  ).filter((name) => owners.imageActive(name));
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
        "--progress=plain",
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

async function publishStarlightTag(
  name: string,
  candidate: string,
  buildNumber: string,
  executor: CommandExecutor,
) {
  if (name !== "starlight-karma-bot") return;
  const tag = await executor([
    "docker",
    "buildx",
    "imagetools",
    "create",
    "--tag",
    `${registry}/${name}:2.0.0-${buildNumber}`,
    candidate,
  ]);
  if (tag.exitCode !== 0) throw new Error(`Version tag failed for ${name}`);
}

export async function pushImages(
  options: PushOptions,
  dependencies: {
    readonly executor?: CommandExecutor;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly readRetainableImages?: () => Promise<QualifiedImageInventory>;
    /** The registry that owns each image; v1 until the window's catalog flip. */
    readonly owners?: PublicationOwners;
    readonly getManifestDigest?: (image: string) => Promise<string>;
    readonly verifyRegistryAccess?: RegistryAccessVerifier;
    readonly verifySourceLabel?: (image: string) => Promise<void>;
    readonly getRuntimeFingerprint?: (
      image: string,
    ) => Promise<string | undefined>;
    readonly smokeCandidate?: (
      target: string,
      candidate: string,
      contractHash: string,
    ) => Promise<void>;
    readonly writeDeliveryMetadata?: (
      digests: Readonly<Record<string, string>>,
      retained: readonly ArtifactVersion[],
    ) => Promise<void>;
    readonly writeText?: TextWriter;
  } = {},
): Promise<void> {
  const { targets, commit, buildNumber, contractHash } = options;
  const executor = dependencies.executor ?? execute;
  const environment = dependencies.environment ?? Bun.env;
  const readOriginals =
    dependencies.readRetainableImages ??
    (() => readRetainableImages(undefined, undefined, dependencies.owners));
  const getManifestDigest = dependencies.getManifestDigest ?? manifestDigest;
  const verifyRegistryAccess =
    dependencies.verifyRegistryAccess ?? ensureDockerHubAccess;
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
  const writeDeliveryMetadata =
    dependencies.writeDeliveryMetadata ?? setDeliveryDigestMetadata;
  const writeText = dependencies.writeText ?? Bun.write;
  const originals = await readOriginals();
  const targetsWithPins = targets.map((name) => {
    imageIdentity(name, dependencies.owners);
    return { name, original: originals.get(name) };
  });
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
        "--progress=plain",
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

  const deliveryDigests: Record<string, string> = {};
  const retained = unbuiltImageOriginals(originals, targets);
  const outcomes: PushOutcome[] = [];
  for (const { name, original } of targetsWithPins) {
    const image = `${registry}/${name}`;
    const candidateTag = `${image}:candidate-${commit}`;
    const digest = await getManifestDigest(candidateTag);
    const candidate = `${image}@${digest}`;
    await verifyRegistryAccess(name, digest);
    if (applicationImageTargets.has(name)) {
      await verifySourceLabel(candidate);
      await smokeCandidate(name, candidate, contractHash);
    }
    const newFingerprint = await getRuntimeFingerprint(candidate);
    if (newFingerprint === undefined)
      throw new TransientError(`Candidate unavailable: ${candidate}`);
    const outcome =
      original === undefined
        ? "no-pin-bumped"
        : await classifyRuntimeChange(
            {
              image,
              pinnedDigest: original.digest,
              candidateFingerprint: newFingerprint,
            },
            getRuntimeFingerprint,
          );
    outcomes.push({ image: name, outcome });
    if (original !== undefined && outcome === "content-unchanged") {
      // Same runtime bytes (VERSION/GIT_SHA excluded): Delivery keeps the
      // original, pending or qualified, instead of registering a duplicate.
      retained.push(original);
      continue;
    }
    await publishStarlightTag(name, candidate, buildNumber, executor);
    deliveryDigests[`shepherdjerred/${name}`] = digest;
  }
  await writeDeliveryMetadata(deliveryDigests, retained);
  await writeText(pushOutcomes, `${JSON.stringify(outcomes)}\n`);
}

async function main(): Promise<void> {
  const options = parseBakeArguments(Bun.argv.slice(2));
  const commit = Bun.env["CI_COMMIT_SHA"];
  const buildNumber = Bun.env["CI_RELEASE_NUMBER"];
  if (commit === undefined || buildNumber === undefined) {
    throw new Error("CI_COMMIT_SHA and CI_RELEASE_NUMBER are required");
  }
  await Promise.all([
    rm(selectionReport, { force: true }),
    rm(pushOutcomes, { force: true }),
  ]);

  const owners = publicationOwners(options.catalogV2 ? "v2" : "v1");
  const originals = options.push
    ? await readRetainableImages(undefined, undefined, owners)
    : undefined;
  const selection = await selectedTargets(options, commit, execute);
  const bakeTargets =
    originals === undefined
      ? expandTargets(selection.targets)
      : publicationTargets(selection.targets, originals, owners);
  if (bakeTargets.length === 0) {
    console.log("no image-owning packages affected — nothing to build");
    await annotate(["--report", selectionReport]);
    if (options.push) {
      await setDeliveryDigestMetadata({}, [...(originals?.values() ?? [])]);
      await Bun.write(pushOutcomes, "[]\n");
    }
    return;
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
    await pushImages(
      {
        targets: bakeTargets,
        commit,
        buildNumber,
        contractHash,
      },
      {
        owners,
        ...(originals === undefined
          ? {}
          : { readRetainableImages: () => Promise.resolve(originals) }),
      },
    );
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
