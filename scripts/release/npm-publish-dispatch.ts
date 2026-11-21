import path from "node:path";
import { z } from "zod";
import { NPM_CHANNEL_PACKAGES } from "../lib/artifacts/npm-package-archive.ts";
import { setupGitAuth } from "../lib/github-auth.ts";
import { run, runAllowExit } from "../lib/run.ts";

const defaultRepoRoot = path.resolve(import.meta.dir, "../..");

export function normalizePackageDir(
  pkgDir: string,
  baseDir: string = process.cwd(),
  root: string = defaultRepoRoot,
): string {
  const absolute = path.resolve(baseDir, pkgDir);
  return path.relative(root, absolute);
}

/**
 * Production releases of Delivery channel packages (such as `packages/webring`)
 * are published from frozen `delivery-artifacts` tarballs by Delivery's own
 * channel deployment (`packages/temporal/src/activities/delivery/model/channel.ts`).
 * Rebuilding and publishing an un-suffixed release here would produce distinct
 * tarball bytes (`DeliveryChannelVersionDiffers`) and bypass channel selection.
 */
export function assertNotDeliveryChannelRelease(options: {
  packageDir: string;
  tag: "latest" | "dev";
  devSuffix: string;
}): void {
  const channelPkg = NPM_CHANNEL_PACKAGES.find(
    (candidate) => candidate.directory === options.packageDir,
  );
  if (channelPkg === undefined) return;
  if (options.tag === "dev" && options.devSuffix !== "") return;
  throw new Error(
    `${options.packageDir} (${channelPkg.name}) production releases are owned ` +
      `by the Delivery ${channelPkg.serviceId}/latest channel from frozen ` +
      `delivery-artifacts tarballs; publish-npm.ts only permits ephemeral ` +
      `dev releases (--tag dev --dev-suffix <n>) for channel packages.`,
  );
}

export type RemoteRefs = {
  readonly heads: ReadonlyMap<string, string>;
  readonly tags: ReadonlyMap<string, string>;
};

export function parseLsRemoteRefs(stdout: string): RemoteRefs {
  const heads = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const rawLine of stdout.split("\n")) {
    const [sha, ref] = rawLine.trim().split(/\s+/);
    if (
      sha === undefined ||
      ref === undefined ||
      !/^[0-9a-f]{40}$/u.test(sha)
    ) {
      continue;
    }
    if (ref.startsWith("refs/heads/")) {
      heads.set(ref, sha);
    } else if (ref.startsWith("refs/tags/")) {
      recordRemoteTagRef(tags, ref, sha);
    }
  }
  return { heads, tags };
}

function recordRemoteTagRef(
  tags: Map<string, string>,
  ref: string,
  sha: string,
): void {
  if (ref.endsWith("^{}")) {
    tags.set(ref.slice(0, -3), sha);
  } else if (!tags.has(ref)) {
    tags.set(ref, sha);
  }
}

function stripRefPrefix(ref: string): string {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : ref;
}

function findMatchingRemoteRef(
  headSha: string,
  remote: RemoteRefs,
): string | null {
  if (remote.heads.get("refs/heads/main") === headSha) {
    return "refs/heads/main";
  }
  for (const [tagRef, sha] of remote.tags) {
    if (sha === headSha) return tagRef;
  }
  for (const [branchRef, sha] of remote.heads) {
    if (sha === headSha) return branchRef;
  }
  return null;
}

export type GitInspector = {
  readonly statusPorcelain: () => Promise<string>;
  readonly headSha: () => Promise<string>;
  readonly symbolicRef: () => Promise<string | null>;
  readonly lsRemoteOrigin: () => Promise<string>;
  readonly supportsSourceShaAtHead: () => Promise<boolean>;
  readonly isAncestorOfOriginMain: (
    headSha: string,
    mainSha: string,
  ) => Promise<boolean>;
};

export type DispatchSource = {
  readonly workflowRef?: string;
  readonly sourceRef: string;
  readonly sourceSha: string;
};

function buildDispatchSourceForRef(
  ref: string,
  sourceSha: string,
  supportsWorkflowAtHead: boolean,
): DispatchSource {
  return {
    ...(supportsWorkflowAtHead ? { workflowRef: stripRefPrefix(ref) } : {}),
    sourceRef: ref,
    sourceSha,
  };
}

export async function resolveDispatchSource(
  git: GitInspector,
): Promise<DispatchSource> {
  const porcelain = await git.statusPorcelain();
  if (porcelain.trim() !== "") {
    throw new Error(
      "Cannot dispatch npm-publish.yml with uncommitted or untracked local " +
        "changes; commit and push your changes first so GitHub Actions builds " +
        "the exact inspected source.",
    );
  }

  const rawHeadSha = await git.headSha();
  const headSha = rawHeadSha.trim();
  if (!/^[0-9a-f]{40}$/u.test(headSha)) {
    throw new Error(`Expected 40-character HEAD commit SHA, got: ${headSha}`);
  }

  const [symbolicRef, lsRemoteStdout, supportsWorkflowAtHead] =
    await Promise.all([
      git.symbolicRef(),
      git.lsRemoteOrigin(),
      git.supportsSourceShaAtHead(),
    ]);
  const remote = parseLsRemoteRefs(lsRemoteStdout);

  if (symbolicRef !== null) {
    return resolveSymbolicBranchSource(
      symbolicRef,
      headSha,
      remote,
      supportsWorkflowAtHead,
    );
  }

  const matchedRef = findMatchingRemoteRef(headSha, remote);
  if (matchedRef !== null) {
    return buildDispatchSourceForRef(
      matchedRef,
      headSha,
      supportsWorkflowAtHead,
    );
  }

  const mainSha = remote.heads.get("refs/heads/main");
  if (
    mainSha !== undefined &&
    (await git.isAncestorOfOriginMain(headSha, mainSha))
  ) {
    return { sourceRef: headSha, sourceSha: headSha };
  }

  throw new Error(
    `Detached HEAD (${headSha}) is not published on origin; push a branch or ` +
      `tag containing this commit before dispatching npm-publish.yml.`,
  );
}

function resolveSymbolicBranchSource(
  symbolicRef: string,
  headSha: string,
  remote: RemoteRefs,
  supportsWorkflowAtHead: boolean,
): DispatchSource {
  const remoteBranchSha = remote.heads.get(symbolicRef);
  if (remoteBranchSha !== undefined) {
    if (remoteBranchSha !== headSha) {
      throw new Error(
        `Local ${symbolicRef} (${headSha}) differs from origin (${remoteBranchSha}); ` +
          `push your commits before dispatching npm-publish.yml.`,
      );
    }
    return buildDispatchSourceForRef(
      symbolicRef,
      headSha,
      supportsWorkflowAtHead,
    );
  }

  const matchedRef = findMatchingRemoteRef(headSha, remote);
  if (matchedRef !== null) {
    return buildDispatchSourceForRef(
      matchedRef,
      headSha,
      supportsWorkflowAtHead,
    );
  }

  throw new Error(
    `Local ${symbolicRef} (${headSha}) is not published on origin; ` +
      `push your branch before dispatching npm-publish.yml.`,
  );
}

function createGitInspector(
  root: string,
  env: Record<string, string>,
): GitInspector {
  const quietOpts = {
    cwd: root,
    env,
    capture: true,
    echoCapturedStdout: false,
  };
  return {
    statusPorcelain: async () => {
      const res = await run(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        quietOpts,
      );
      return res.stdout;
    },
    headSha: async () => {
      const res = await run(["git", "rev-parse", "HEAD"], quietOpts);
      return res.stdout;
    },
    symbolicRef: async () => {
      const res = await runAllowExit(
        ["git", "symbolic-ref", "-q", "HEAD"],
        quietOpts,
      );
      return res.exitCode === 0 ? res.stdout.trim() : null;
    },
    lsRemoteOrigin: async () => {
      const res = await run(
        ["git", "ls-remote", "origin", "refs/heads/*", "refs/tags/*"],
        quietOpts,
      );
      return res.stdout;
    },
    supportsSourceShaAtHead: async () => {
      const res = await runAllowExit(
        ["git", "show", "HEAD:.github/workflows/npm-publish.yml"],
        quietOpts,
      );
      return res.exitCode === 0 && res.stdout.includes("source_sha:");
    },
    isAncestorOfOriginMain: async (headSha, mainSha) => {
      await run(
        [
          "git",
          "fetch",
          "--no-tags",
          "origin",
          "refs/heads/main:refs/remotes/origin/main",
        ],
        { cwd: root, env },
      );
      const res = await runAllowExit(
        ["git", "merge-base", "--is-ancestor", headSha, mainSha],
        quietOpts,
      );
      return res.exitCode === 0;
    },
  };
}

export function buildWorkflowDispatchArgs(options: {
  packageDir: string;
  tag: "latest" | "dev";
  sourceRef: string;
  sourceSha: string;
  workflowRef?: string;
  devSuffix?: string;
  dryRun?: boolean;
}): string[] {
  const args = ["workflow", "run", "npm-publish.yml"];
  if (options.workflowRef !== undefined && options.workflowRef !== "") {
    args.push("--ref", options.workflowRef);
  }
  args.push(
    "-F",
    `package_dir=${options.packageDir}`,
    "-F",
    `tag=${options.tag}`,
    "-F",
    `source_ref=${options.sourceRef}`,
    "-F",
    `source_sha=${options.sourceSha}`,
  );
  if (options.devSuffix !== undefined && options.devSuffix !== "") {
    args.push("-F", `dev_suffix=${options.devSuffix}`);
  }
  if (options.dryRun === true) {
    args.push("-F", "dry_run=true");
  }
  return args;
}

const GitHubAppEnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_INSTALLATION_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
});

export async function dispatchToGitHubActions(
  options: {
    packageDir: string;
    tag: "latest" | "dev";
    devSuffix: string;
    dryRun: boolean;
  },
  env: Record<string, string | undefined> = Bun.env,
): Promise<void> {
  const repoRelativeDir = normalizePackageDir(options.packageDir);
  assertNotDeliveryChannelRelease({
    packageDir: repoRelativeDir,
    tag: options.tag,
    devSuffix: options.devSuffix,
  });

  let extraEnv: Record<string, string> = {};
  let cleanup: (() => Promise<void>) | undefined;

  const appAuth = GitHubAppEnvSchema.safeParse(env);
  if (appAuth.success) {
    const gitAuth = await setupGitAuth(defaultRepoRoot);
    extraEnv = gitAuth.env;
    cleanup = gitAuth.cleanup;
  }

  try {
    const source = await resolveDispatchSource(
      createGitInspector(defaultRepoRoot, extraEnv),
    );
    const args = buildWorkflowDispatchArgs({
      packageDir: repoRelativeDir,
      tag: options.tag,
      sourceRef: source.sourceRef,
      sourceSha: source.sourceSha,
      ...(source.workflowRef === undefined
        ? {}
        : { workflowRef: source.workflowRef }),
      devSuffix: options.devSuffix,
      dryRun: options.dryRun,
    });
    console.log(
      `+++ dispatching GitHub Actions workflow (npm-publish.yml) for ${repoRelativeDir} @ ${source.sourceSha}`,
    );
    await run(["gh", ...args], { env: extraEnv });
    console.log(
      `OK: Dispatched npm-publish.yml for ${repoRelativeDir} (--tag ${options.tag}, sha ${source.sourceSha}).\n` +
        `Monitor progress with: gh run list --workflow=npm-publish.yml`,
    );
  } finally {
    if (cleanup !== undefined) await cleanup();
  }
}
