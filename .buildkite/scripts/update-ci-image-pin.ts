#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { setupGitAuth } from "../../scripts/lib/github-auth.ts";
import { run, runAllowExit, tmpBase } from "../../scripts/lib/run.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";
import { runMain } from "../../scripts/lib/transient.ts";
import {
  CI_IMAGE_IGNORED_ENV_PREFIXES,
  imageRuntimeFingerprint,
} from "./application-image-runtime.ts";
import {
  ciImageDefinition,
  ciImageSourceFingerprint,
  type CiImageDefinition,
} from "./build-ci-image-core.ts";
import {
  ciImagePromotionFiles,
  classifyCiImageRuntimePromotion,
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
import {
  MONOREPO_REPO,
  openOrUpdatePullRequest,
  retireStalePromotion,
} from "./update-ci-image-pin-github.ts";

const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const COMMIT_PATTERN = /^[\da-f]{40}$/;
const BUN_INSTALL_WRAPPER = fileURLToPath(
  new URL("bun-install.sh", import.meta.url),
);

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

async function pinStateAtRevision(
  cloneDir: string,
  revision: string,
  definition: CiImageDefinition,
  env: Record<string, string>,
): Promise<CiImagePinState> {
  const [stateResult, digestResult] = await Promise.all([
    run(
      ["git", "-C", cloneDir, "show", `${revision}:${definition.stateFile}`],
      {
        env,
        capture: true,
      },
    ),
    run(
      ["git", "-C", cloneDir, "show", `${revision}:${definition.digestFile}`],
      { env, capture: true },
    ),
  ]);
  const state = parseCiImagePinState(JSON.parse(stateResult.stdout));
  verifyDigestFile(digestResult.stdout, state);
  return state;
}

/**
 * Guard the "content-unchanged" skip against a race: the auto-merge-enabled
 * pending PR (or any other pin update) can merge into main after `mainState`
 * was read, which would leave the runtime comparison — and thus the decision to
 * skip promotion — measured against a now-obsolete pin, stranding CI on the
 * wrong configuration. Re-fetch origin/main and, if the pin moved, fail
 * transiently so the retry anchor re-runs the job and re-compares the candidate
 * against the current pin.
 */
async function assertMainPinUnchanged(options: {
  readonly cloneDir: string;
  readonly definition: CiImageDefinition;
  readonly comparedAgainst: CiImagePinState;
  readonly env: Record<string, string>;
}): Promise<void> {
  const { cloneDir, definition, comparedAgainst, env } = options;
  await run(["git", "-C", cloneDir, "fetch", "origin", "main"], { env });
  const current = await pinStateAtRevision(
    cloneDir,
    "origin/main",
    definition,
    env,
  );
  if (current.digest !== comparedAgainst.digest) {
    throw new TransientError(
      `${definition.name} main pin moved from ${comparedAgainst.digest} to ${current.digest} during evaluation; retrying to re-compare the candidate against the current pin`,
    );
  }
}

/**
 * The single exit for every "no promotion warranted" decision. Whatever check
 * decided to skip (digest-equal, older-than-pin, or content-unchanged), this
 * neutralizes any still-open auto-merge promotion PR so it cannot land an
 * obsolete digest, then re-verifies that main's pin did not move underneath the
 * decision. Routing all skips through here keeps the two guarantees in lockstep
 * and prevents a new skip path from silently bypassing either one.
 */
async function finalizeSkippedPromotion(options: {
  readonly cloneDir: string;
  readonly definition: CiImageDefinition;
  readonly pending:
    | { readonly sha: string; readonly state: CiImagePinState }
    | undefined;
  readonly mainState: CiImagePinState;
  readonly reason: string;
  readonly env: Record<string, string>;
}): Promise<void> {
  const { cloneDir, definition, pending, mainState, reason, env } = options;
  console.log(`${definition.name} ${reason}; skipping pin promotion`);
  if (pending !== undefined) {
    await retireStalePromotion({ cloneDir, definition, env });
  }
  await assertMainPinUnchanged({
    cloneDir,
    definition,
    comparedAgainst: mainState,
    env,
  });
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
    await run([BUN_INSTALL_WRAPPER, "--lockfile-only"], {
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

async function runtimeFingerprint(
  image: string,
  env: Record<string, string>,
): Promise<string | undefined> {
  return imageRuntimeFingerprint(
    image,
    async (command) => {
      return runAllowExit([...command], { env, capture: true });
    },
    CI_IMAGE_IGNORED_ENV_PREFIXES,
  );
}

async function promote(candidatePath: string, dryRun: boolean): Promise<void> {
  const candidate = parseCiImageCandidate(await Bun.file(candidatePath).json());
  const definition = ciImageDefinition(candidate.image);
  const currentState = await readStateFile(definition.stateFile);
  verifyDigestFile(await Bun.file(definition.digestFile).text(), currentState);
  const candidateState = stateFromCandidate(candidate);
  const localNewest = newestPinState([currentState, candidateState]);
  const noDigestChange = localNewest.digest === currentState.digest;
  const olderThanPin = !noDigestChange && localNewest !== candidateState;

  if (dryRun) {
    // Dry-run never clones or mutates remote state; report the decision only.
    if (noDigestChange) {
      console.log(`${definition.name} candidate has no runtime digest change`);
    } else if (olderThanPin) {
      console.log(
        `${definition.name} candidate is older than the committed pin`,
      );
    } else {
      console.log(
        `DRYRUN: would promote ${definition.name} build ${candidate.buildNumber.toString()} at ${candidate.digest}`,
      );
    }
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
    const pending = await pendingState(cloneDir, definition);

    // Every "no promotion" exit routes through finalizeSkippedPromotion so a
    // stale auto-merge PR can never land after the build declined to promote,
    // and a mid-run main pin move is always caught — no skip path can bypass
    // either guarantee.
    if (noDigestChange) {
      await finalizeSkippedPromotion({
        cloneDir,
        definition,
        pending,
        mainState,
        reason: "candidate has no runtime digest change",
        env: auth.env,
      });
      return;
    }
    if (olderThanPin) {
      await finalizeSkippedPromotion({
        cloneDir,
        definition,
        pending,
        mainState,
        reason: "candidate is older than the committed pin",
        env: auth.env,
      });
      return;
    }

    const mainSourceFingerprint = await sourceFingerprintAtRevision(
      cloneDir,
      definition,
      "origin/main",
      auth.env,
    );
    if (!isCurrentSourceCandidate(candidateState, mainSourceFingerprint)) {
      // A superseded-source candidate establishes nothing about the current
      // pin's currency, so it must not retire a possibly-legitimate pending
      // promotion; leave any pending PR untouched.
      console.log(
        `${definition.name} candidate source is superseded by current main`,
      );
      return;
    }
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

    const runtimeOutcome = await classifyCiImageRuntimePromotion(
      {
        repository: definition.repository,
        pinnedDigest: mainState.digest,
        candidateDigest: promoted.digest,
      },
      async (image) => runtimeFingerprint(image, auth.env),
    );
    if (runtimeOutcome === "content-unchanged") {
      await finalizeSkippedPromotion({
        cloneDir,
        definition,
        pending,
        mainState,
        reason: "candidate runtime content is unchanged",
        env: auth.env,
      });
      return;
    }
    if (runtimeOutcome === "pin-unresolvable-bumped") {
      console.warn(
        `${definition.name} current pin could not be fingerprinted; promoting the verified candidate`,
      );
    }

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
