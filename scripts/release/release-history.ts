import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { NPM_PACKAGE_POLICIES } from "../lib/npm-release-eligibility.ts";
import { run, tmpBase } from "../lib/run.ts";

/**
 * Fetches every npm package's release tags with their history but without
 * blobs. Eligibility reads only file names (tree entries) and each tag's
 * `package.json`, which Git fetches on demand from the promisor remote.
 */
export async function fetchNpmPackageTags(
  root: string,
  env: Record<string, string> = {},
): Promise<void> {
  for (const policy of NPM_PACKAGE_POLICIES) {
    const tagRef = `refs/tags/${policy.tagPrefix}*`;
    await run(
      [
        "git",
        "fetch",
        "--no-tags",
        "--filter=blob:none",
        "origin",
        `${tagRef}:${tagRef}`,
      ],
      { cwd: root, env },
    );
  }
}

export type ReleaseHistory = {
  /** The bare repository eligibility reads; pass it as `root`. */
  readonly path: string;
  readonly cleanup: () => Promise<void>;
};

/**
 * A throwaway bare, blobless repository holding the release tags and the
 * release target.
 *
 * The CI workspace is a depth-one checkout. Fetching the npm release tags into
 * it pulls the whole history behind each tag with every blob (about 1.1 GB per
 * run on the CI pool), and fetching them blobless into a full repository makes
 * Git repack the blobs it already has (still 0.4 GB). A separate bare
 * repository under the step's temporary directory holds only commits and trees
 * (tens of MB) and answers the same questions with the same Git commands.
 */
export async function openReleaseHistory(
  workspace: string,
  env: Record<string, string> = {},
): Promise<ReleaseHistory> {
  const remote = await run(["git", "remote", "get-url", "origin"], {
    cwd: workspace,
    capture: true,
    echoCapturedStdout: false,
  });
  const directory = await mkdtemp(path.join(tmpBase(), "release-history-"));
  try {
    await run(["git", "init", "--bare", "--quiet", directory]);
    for (const args of [
      ["remote", "add", "origin", remote.stdout.trim()],
      ["config", "remote.origin.promisor", "true"],
      ["config", "remote.origin.partialclonefilter", "blob:none"],
    ]) {
      await run(["git", ...args], { cwd: directory });
    }
    await fetchNpmPackageTags(directory, env);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path: directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function fetchReleaseTarget(
  root: string,
  env: Record<string, string> = {},
  branch = "main",
): Promise<string> {
  const remoteRef = `refs/heads/${branch}`;
  const remote = await run(["git", "ls-remote", "origin", remoteRef], {
    cwd: root,
    env,
    capture: true,
    echoCapturedStdout: false,
  });
  const remoteSha = remote.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .find((value) => value !== undefined && /^[0-9a-f]{40}$/.test(value));
  if (remoteSha === undefined) {
    throw new Error(`Could not resolve origin/${branch} for release preflight`);
  }

  const localRef = `refs/remotes/origin/${branch}`;
  await run(
    ["git", "fetch", "--no-tags", "origin", `${remoteRef}:${localRef}`],
    {
      cwd: root,
      env,
    },
  );
  const local = await run(["git", "rev-parse", localRef], {
    cwd: root,
    capture: true,
    echoCapturedStdout: false,
  });
  const localSha = local.stdout.trim();
  if (localSha !== remoteSha) {
    throw new Error(
      `origin/${branch} moved while release preflight fetched it ` +
        `(${remoteSha} -> ${localSha}); retry the release lane`,
    );
  }
  return remoteSha;
}
