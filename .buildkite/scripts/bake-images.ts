import { rm } from "node:fs/promises";
import { asRecord } from "../../scripts/lib/json.ts";
import { bakeFailureIsTransient } from "./bake-retry.ts";
import {
  expandTargets,
  findPinnedDigest,
  knownImageTargets,
  parseBakeArguments,
  parseBuildkiteCommits,
  parseStringArray,
} from "./migration-core.ts";

const registry = "ghcr.io/shepherdjerred";
const selectionReport = "image-selection-report.json";
const pushOutcomes = "image-push-outcomes.json";
const versionsPath = "packages/homelab/src/cdk8s/src/versions.ts";
type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function execute(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<CommandResult> {
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

async function annotate(commandArguments: readonly string[]): Promise<void> {
  const result = await execute([
    "bun",
    "--no-install",
    ".buildkite/scripts/annotate-image-summary.ts",
    ...commandArguments,
  ]);
  if (result.exitCode !== 0) {
    console.error("WARN: image summary annotation failed (non-fatal)");
  }
}

async function lastGreenCommit(
  currentCommit: string,
): Promise<string | undefined> {
  const token = Bun.env["BUILDKITE_API_TOKEN"];
  if (token === undefined) return undefined;
  const response = await fetch(
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
  const exists = await execute(["git", "cat-file", "-e", `${commit}^{commit}`]);
  return exists.exitCode === 0 ? commit : undefined;
}

async function selectedTargets(
  options: { readonly affected: boolean; readonly push: boolean },
  commit: string,
): Promise<{ readonly targets: string[]; readonly fallbackReason: string }> {
  let base: string | undefined;
  let fallbackReason = "full build requested (no --affected/--push scoping)";
  if (options.affected) {
    const result = await execute(["git", "merge-base", "origin/main", "HEAD"]);
    if (result.exitCode === 0) base = result.stdout.trim();
    else fallbackReason = "could not resolve merge-base with origin/main";
  } else if (options.push) {
    base = await lastGreenCommit(commit);
    if (base === undefined)
      fallbackReason = "could not resolve last green main build";
  }
  if (base === undefined) return { targets: knownImageTargets, fallbackReason };

  const selection = await execute([
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
  const parsed = parseStringArray(
    JSON.parse(selection.stdout.trim()),
    "image selection",
  );
  if (!parsed.every((target) => knownImageTargets.includes(target))) {
    return {
      targets: knownImageTargets,
      fallbackReason: "image selector returned invalid targets",
    };
  }
  return { targets: parsed, fallbackReason: "" };
}

async function manifestDigest(image: string): Promise<string> {
  const result = await execute([
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

async function imageLayers(image: string): Promise<string[] | undefined> {
  const result = await execute([
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

async function ensureBuilder(): Promise<void> {
  const inspect = await execute(["docker", "buildx", "inspect", "ci"]);
  if (inspect.exitCode === 0) return;
  const create = await execute([
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

async function runSmoke(
  bakeTargets: readonly string[],
  selected: readonly string[],
  contractHash: string,
): Promise<void> {
  const smokeArguments = bakeTargets.flatMap((target) => [
    "--set",
    `${target}.target=smoke`,
  ]);
  const caddyfile = Bun.env["CADDYFILE_SMOKE_PATH"];
  if (selected.includes("infra") && caddyfile === undefined) {
    throw new Error("CADDYFILE_SMOKE_PATH is required for infra smoke");
  }
  if (caddyfile !== undefined)
    smokeArguments.push("--allow", `fs.read=${caddyfile}`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await execute(
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
        ...Bun.env,
        VERSION: "dev",
        GIT_SHA: "unknown",
        CONTRACT_HASH: contractHash,
        PUSH_CACHE: "false",
      },
    );
    if (result.exitCode === 0) return;
    const output = `${result.stdout}${result.stderr}`;
    if (!bakeFailureIsTransient(output)) process.exit(1);
    if (attempt === 3) process.exit(34);
    await Bun.sleep(attempt * attempt * 15_000);
  }
}

type PushOutcome = {
  readonly image: string;
  readonly outcome:
    | "bumped"
    | "content-unchanged"
    | "pin-unresolvable-bumped"
    | "no-pin-bumped";
};

async function pushImages(
  targets: readonly string[],
  commit: string,
  buildNumber: string,
  contractHash: string,
): Promise<void> {
  const push = await execute(
    ["docker", "buildx", "bake", "--builder", "ci", "--push", ...targets],
    {
      ...Bun.env,
      VERSION: buildNumber,
      GIT_SHA: commit,
      CONTRACT_HASH: contractHash,
      PUSH_CACHE: "true",
      PUSH_IMAGES: "true",
    },
  );
  if (push.exitCode !== 0) throw new Error("Production image push failed");

  const versions = await Bun.file(versionsPath).text();
  const digests: Record<string, string> = {};
  const outcomes: PushOutcome[] = [];
  for (const name of targets) {
    const image = `${registry}/${name}`;
    const digest = await manifestDigest(`${image}:${commit}`);
    const pinned = findPinnedDigest(versions, name);
    if (pinned === undefined) {
      outcomes.push({ image: name, outcome: "no-pin-bumped" });
    } else {
      const oldLayers = await imageLayers(`${image}@${pinned}`);
      const newLayers = await imageLayers(`${image}:${commit}`);
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
      const tag = await execute([
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
  await setDigestMetadata(digests);
  await Bun.write(pushOutcomes, `${JSON.stringify(outcomes)}\n`);
}

async function writeFallbackReport(
  targets: readonly string[],
  reason: string,
): Promise<void> {
  const targetReasons = Object.fromEntries(
    targets.map((target) => [target, [reason]]),
  );
  await Bun.write(
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
  await runSmoke(bakeTargets, selection.targets, contractHash);
  if (options.push) {
    await pushImages(bakeTargets, commit, buildNumber, contractHash);
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
