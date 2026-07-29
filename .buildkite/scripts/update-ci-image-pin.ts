#!/usr/bin/env bun

import { rm } from "node:fs/promises";

import { setupGitAuth } from "../../scripts/lib/github-auth.ts";
import { run, runAllowExit, tmpBase } from "../../scripts/lib/run.ts";
import { runMain } from "../../scripts/lib/transient.ts";
import {
  ciImageDefinition,
  ciImageSourceFingerprint,
  type CiImageDefinition,
} from "./build-ci-image-core.ts";
import {
  ciImagePromotionFiles,
  isCurrentSourceCandidate,
  newestPinState,
  parseCiImageCandidate,
  parseCiImagePinState,
  playwrightVersionFromDockerfile,
  PLAYWRIGHT_PACKAGE_TARGETS,
  PLAYWRIGHT_VERSION_FILE,
  rewritePlaywrightPackage,
  serializedState,
  stateFromCandidate,
  verifyDigestFile,
  type CiImagePinState,
} from "./update-ci-image-pin-core.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const COMMIT_PATTERN = /^[\da-f]{40}$/;

async function readStateFile(path: string): Promise<CiImagePinState> {
  return parseCiImagePinState(await Bun.file(path).json());
}

async function pendingState(
  cloneDir: string,
  definition: CiImageDefinition,
): Promise<
  { readonly sha: string; readonly state: CiImagePinState } | undefined
> {
  const revision = `refs/remotes/origin/${definition.branch}`;
  const result = await runAllowExit(
    ["git", "-C", cloneDir, "rev-parse", "--verify", "--quiet", revision],
    { capture: true },
  );
  if (result.exitCode === 1) {
    return undefined;
  }
  if (result.exitCode !== 0) {
    throw new Error(`Could not inspect pending branch ${definition.branch}`);
  }
  const sha = result.stdout.trim();
  if (!COMMIT_PATTERN.test(sha)) {
    throw new Error(`Pending branch ${definition.branch} has an invalid SHA`);
  }
  const [stateResult, digestResult] = await Promise.all([
    run(
      ["git", "-C", cloneDir, "show", `${revision}:${definition.stateFile}`],
      {
        capture: true,
      },
    ),
    run(
      ["git", "-C", cloneDir, "show", `${revision}:${definition.digestFile}`],
      { capture: true },
    ),
  ]);
  const state = parseCiImagePinState(JSON.parse(stateResult.stdout));
  verifyDigestFile(digestResult.stdout, state);
  return { sha, state };
}

async function openOrUpdatePullRequest(options: {
  readonly cloneDir: string;
  readonly definition: CiImageDefinition;
  readonly state: CiImagePinState;
  readonly env: Record<string, string>;
  readonly expectedRemoteSha: string | undefined;
}): Promise<void> {
  const { cloneDir, definition, state, env, expectedRemoteSha } = options;
  await run(
    [
      "git",
      "-C",
      cloneDir,
      "push",
      `--force-with-lease=refs/heads/${definition.branch}:${expectedRemoteSha ?? ""}`,
      "-u",
      "origin",
      definition.branch,
    ],
    { env },
  );
  const listed = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      MONOREPO_REPO,
      "--head",
      definition.branch,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { env, capture: true },
  );
  let prNumber = listed.stdout.trim();
  if (prNumber === "") {
    await run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        MONOREPO_REPO,
        "--base",
        "main",
        "--head",
        definition.branch,
        "--title",
        `chore(ci): promote ${definition.name} candidate`,
        "--body",
        [
          `Promotes ${definition.name} build ${state.buildNumber.toString()} by immutable digest.`,
          "",
          "The PR CI lanes consume this candidate digest before auto-merge.",
        ].join("\n"),
      ],
      { env },
    );
    const viewed = await run(
      [
        "gh",
        "pr",
        "view",
        "--repo",
        MONOREPO_REPO,
        definition.branch,
        "--json",
        "number",
        "-q",
        ".number",
      ],
      { env, capture: true },
    );
    prNumber = viewed.stdout.trim();
  }
  if (!/^\d+$/.test(prNumber)) {
    throw new Error("CI image pin PR number is invalid");
  }
  await run(
    [
      "gh",
      "pr",
      "merge",
      "--repo",
      MONOREPO_REPO,
      prNumber,
      "--auto",
      "--squash",
    ],
    { env },
  );
}

async function preparePlaywrightPromotion(
  cloneDir: string,
  definition: CiImageDefinition,
  state: CiImagePinState,
  env: Record<string, string>,
): Promise<void> {
  if (definition.name !== "ci-playwright") {
    return;
  }
  const dockerfile = await run(
    [
      "git",
      "-C",
      cloneDir,
      "show",
      `${state.sourceCommit}:${definition.dockerfile}`,
    ],
    { env, capture: true },
  );
  const version = playwrightVersionFromDockerfile(dockerfile.stdout);
  let packageChanged = false;
  for (const target of PLAYWRIGHT_PACKAGE_TARGETS) {
    const path = `${cloneDir}/${target.path}`;
    const source = await Bun.file(path).text();
    const updated = rewritePlaywrightPackage(source, target, version);
    if (updated !== source) {
      packageChanged = true;
      await Bun.write(path, updated);
    }
  }
  const versionPath = `${cloneDir}/${PLAYWRIGHT_VERSION_FILE}`;
  const activeVersion = await Bun.file(versionPath).text();
  if (activeVersion !== `${version}\n`) {
    await Bun.write(versionPath, `${version}\n`);
  }
  if (packageChanged) {
    await run(["bun", "install", "--lockfile-only"], {
      cwd: cloneDir,
      env: { ...env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    });
  }
}

async function sourceFingerprintAtRevision(
  cloneDir: string,
  definition: CiImageDefinition,
  revision: string,
  env: Record<string, string>,
): Promise<string> {
  const fingerprint = await ciImageSourceFingerprint(
    definition,
    async (path) => {
      const source = await run(
        ["git", "-C", cloneDir, "show", `${revision}:${path}`],
        { env, capture: true },
      );
      return new TextEncoder().encode(source.stdout);
    },
  );
  return `sha256:${fingerprint}`;
}

async function promote(candidatePath: string, dryRun: boolean): Promise<void> {
  const candidate = parseCiImageCandidate(await Bun.file(candidatePath).json());
  const definition = ciImageDefinition(candidate.image);
  const currentState = await readStateFile(definition.stateFile);
  verifyDigestFile(await Bun.file(definition.digestFile).text(), currentState);
  const candidateState = stateFromCandidate(candidate);
  const localNewest = newestPinState([currentState, candidateState]);
  if (localNewest.digest === currentState.digest) {
    console.log(`${definition.name} candidate has no runtime digest change`);
    return;
  }
  if (localNewest !== candidateState) {
    console.log(`${definition.name} candidate is older than the committed pin`);
    return;
  }
  if (dryRun) {
    console.log(
      `DRYRUN: would promote ${definition.name} build ${candidate.buildNumber.toString()} at ${candidate.digest}`,
    );
    return;
  }

  const root = new URL("../..", import.meta.url).pathname;
  const auth = await setupGitAuth(root);
  const cloneDir = `${tmpBase()}/monorepo-${definition.name}-pin-${Date.now().toString()}`;
  try {
    await run(["git", "clone", MONOREPO_WRITE_URL, cloneDir], {
      env: auth.env,
    });
    await run(["git", "-C", cloneDir, "config", "user.email", "ci@sjer.red"], {
      env: auth.env,
    });
    await run(["git", "-C", cloneDir, "config", "user.name", "CI Bot"], {
      env: auth.env,
    });
    const mainState = await readStateFile(
      `${cloneDir}/${definition.stateFile}`,
    );
    verifyDigestFile(
      await Bun.file(`${cloneDir}/${definition.digestFile}`).text(),
      mainState,
    );
    const mainSourceFingerprint = await sourceFingerprintAtRevision(
      cloneDir,
      definition,
      "origin/main",
      auth.env,
    );
    if (!isCurrentSourceCandidate(candidateState, mainSourceFingerprint)) {
      console.log(
        `${definition.name} candidate source is superseded by current main`,
      );
      return;
    }
    const pending = await pendingState(cloneDir, definition);
    const currentPending =
      pending !== undefined &&
      isCurrentSourceCandidate(pending.state, mainSourceFingerprint)
        ? pending
        : undefined;
    const currentStatesBeforeCandidate = [
      ...(isCurrentSourceCandidate(mainState, mainSourceFingerprint)
        ? [mainState]
        : []),
      ...(currentPending === undefined ? [] : [currentPending.state]),
    ];
    const selected = newestPinState([
      ...currentStatesBeforeCandidate,
      candidateState,
    ]);
    const selectedBeforeCandidate =
      currentStatesBeforeCandidate.length === 0
        ? undefined
        : newestPinState(currentStatesBeforeCandidate);
    const promoted =
      selectedBeforeCandidate?.digest === selected.digest
        ? selectedBeforeCandidate
        : selected;

    await run(
      [
        "git",
        "-C",
        cloneDir,
        "checkout",
        "-B",
        definition.branch,
        "origin/main",
      ],
      { env: auth.env },
    );
    await Bun.write(
      `${cloneDir}/${definition.digestFile}`,
      `${promoted.digest}\n`,
    );
    await Bun.write(
      `${cloneDir}/${definition.stateFile}`,
      serializedState(promoted),
    );
    await preparePlaywrightPromotion(cloneDir, definition, promoted, auth.env);
    await run(
      ["git", "-C", cloneDir, "add", ...ciImagePromotionFiles(definition.name)],
      { env: auth.env },
    );
    const diff = await runAllowExit(
      ["git", "-C", cloneDir, "diff", "--cached", "--quiet"],
      { env: auth.env },
    );
    if (diff.exitCode === 0) {
      console.log(`${definition.name} pin is already current`);
      return;
    }
    if (diff.exitCode !== 1) {
      throw new Error("Could not inspect staged CI image pin changes");
    }
    await run(
      [
        "git",
        "-C",
        cloneDir,
        "commit",
        "-m",
        `chore(ci): promote ${definition.name} build ${promoted.buildNumber.toString()}`,
        "-m",
        "Auto-Generated: ci-bot",
      ],
      { env: auth.env },
    );
    await openOrUpdatePullRequest({
      cloneDir,
      definition,
      state: promoted,
      env: auth.env,
      expectedRemoteSha: pending?.sha,
    });
  } finally {
    await auth.cleanup();
    await rm(cloneDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const arguments_ = Bun.argv.slice(2);
  const dryRun = arguments_.includes("--dry-run");
  const values = arguments_.filter((value) => value !== "--dry-run");
  if (values.length !== 2 || values[0] !== "--candidate") {
    throw new Error(
      "Usage: update-ci-image-pin.ts --candidate <candidate.json> [--dry-run]",
    );
  }
  const candidatePath = values[1];
  if (candidatePath === undefined) {
    throw new Error("--candidate requires a path");
  }
  await promote(candidatePath, dryRun);
}

if (import.meta.main) {
  await runMain(main);
}
