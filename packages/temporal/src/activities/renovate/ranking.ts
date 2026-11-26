import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GitHubClient,
  type GitHubReleaseNote,
} from "@shepherdjerred/ops-clients/github.ts";
import {
  DEPENDENCY_DASHBOARD_TITLE,
  parseDependencyDashboard,
} from "@shepherdjerred/ops-clients/renovate.ts";
import {
  RenovateRankingSnapshotSchema,
  type RenovateRankingSnapshot,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";

import { envForEvidenceCollector } from "#activities/agent/agent-task-env.ts";
import {
  activityCancellationSignalOrUndefined,
  safeHeartbeat,
} from "#activities/agent/agent-task-runtime.ts";
import { rootInstallWithoutHooks } from "#activities/bot-clone.ts";
import { captureCommand } from "#activities/command-runner.ts";
import { readLatestRenovateDeltas } from "#activities/ops/facets/renovate-facet.ts";
import { mapWithBoundedConcurrency } from "#activities/ops/renovate-delta/changelog-fetcher.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { readRenovateAdvisories } from "./ranking-advisories.ts";
import {
  extractReleaseEvidence,
  githubReleaseSource,
  rankLookupTargets,
  type ReleaseEvidence,
} from "./ranking-assess.ts";
import {
  parseRenovateLookupInventory,
  type LookupTarget,
} from "./ranking-report.ts";

const OWNER = "shepherdjerred";
const REPOSITORY = "monorepo";
const REPO_URL = `https://github.com/${OWNER}/${REPOSITORY}.git`;

async function optionalEvidence<T>(
  read: () => Promise<T>,
  failed: () => void,
): Promise<T | null> {
  try {
    return await read();
  } catch {
    failed();
    return null;
  }
}

async function readReleaseEvidence(
  targets: readonly LookupTarget[],
  github: Pick<GitHubClient, "releasesBetween">,
  signal?: AbortSignal,
): Promise<{
  evidence: ReadonlyMap<LookupTarget, ReleaseEvidence>;
  failed: number;
}> {
  const lookups = new Map<string, Promise<GitHubReleaseNote[] | null>>();
  const evidence = new Map<LookupTarget, ReleaseEvidence>();
  let failed = 0;
  await mapWithBoundedConcurrency(targets, 4, async (entry) => {
    signal?.throwIfAborted();
    const source = githubReleaseSource(entry);
    if (source === null) return;
    const key = `${source.owner}/${source.name}`;
    const request =
      lookups.get(key) ??
      optionalEvidence(
        () => github.releasesBetween({ ...source, maxPages: 1 }),
        () => {
          failed += 1;
        },
      );
    lookups.set(key, request);
    const releases = await request;
    if (releases !== null)
      evidence.set(entry, extractReleaseEvidence(entry, releases));
  });
  return { evidence, failed };
}

function createLookupCommandRunner(
  dir: string,
  signal: AbortSignal | undefined,
) {
  const stripped = Object.fromEntries(
    Object.keys(Bun.env).map((name) => [name, undefined]),
  );
  const safeEnv = envForEvidenceCollector(dir);
  return async (
    command: string[],
    options: {
      cwd: string;
      env?: Record<string, string | undefined>;
    },
  ): Promise<string> => {
    const result = await captureCommand(command, {
      cwd: options.cwd,
      env: {
        ...stripped,
        ...safeEnv,
        GIT_TERMINAL_PROMPT: "0",
        ...options.env,
      },
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.exitCode !== 0) {
      // Even subprocesses limited to read credentials may include them or a
      // private registry URL in diagnostics. Keep report details in the
      // validated inventory instead of forwarding raw stdout/stderr.
      throw new Error(
        `Renovate inventory command (${command.slice(0, 2).join(" ")}) failed with exit ${String(result.exitCode)}.`,
      );
    }
    return result.stdout.trim();
  };
}

async function collectRenovateRanking(
  temp: string,
  signal: AbortSignal | undefined,
): Promise<RenovateRankingSnapshot> {
  const repoDir = path.join(temp, "repo");
  const run = createLookupCommandRunner(temp, signal);
  safeHeartbeat({ phase: "clone-main" });
  await run(
    [
      "git",
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      "--single-branch",
      "--",
      REPO_URL,
      repoDir,
    ],
    { cwd: temp },
  );
  const baseSha = await run(["git", "rev-parse", "HEAD"], { cwd: repoDir });
  const scannedAt = new Date();
  const { token } = await createGitHubAppInstallationToken({
    permissions: { contents: "read", issues: "read" },
  });
  const github = new GitHubClient({
    owner: OWNER,
    name: REPOSITORY,
    token: () => Promise.resolve(token),
  });

  safeHeartbeat({ phase: "install" });
  await rootInstallWithoutHooks(repoDir, run);
  safeHeartbeat({ phase: "renovate-lookup" });
  const reportPath = path.join(temp, "renovate.json");
  const config: unknown = await Bun.file(
    path.join(repoDir, "renovate.json"),
  ).json();
  await run(
    [
      "bun",
      "scripts/tools/renovate-dry-run.ts",
      "lookup",
      "--report-path",
      reportPath,
      "--isolated-checkout",
    ],
    {
      cwd: repoDir,
      env: {
        BUN_INSTALL_CACHE_DIR: path.join(temp, "bun-install-cache"),
        RENOVATE_GITHUB_COM_TOKEN: token,
        DOCKERHUB_RENOVATE_TOKEN: Bun.env["DOCKERHUB_RENOVATE_TOKEN"],
        LOG_LEVEL: "warn",
      },
    },
  );
  const inventory = parseRenovateLookupInventory(
    await Bun.file(reportPath).json(),
    config,
    scannedAt,
  );
  const warnings = [...inventory.warnings];
  const warn = (message: string) => () => {
    warnings.push(message);
  };
  safeHeartbeat({
    phase: "collect-evidence",
    targets: inventory.targets.length,
  });
  const [dashboard, deltas, advisories, releases] = await Promise.all([
    optionalEvidence(async () => {
      const issue = await github.openIssueByTitle(DEPENDENCY_DASHBOARD_TITLE);
      return parseDependencyDashboard(issue.body);
    }, warn("Could not read Dependency Dashboard tracking status.")),
    optionalEvidence(
      () => readLatestRenovateDeltas(),
      warn("Cached Renovate version deltas were unavailable."),
    ),
    optionalEvidence(
      () => readRenovateAdvisories(inventory.targets, fetch, signal),
      warn("OSV advisory enrichment was unavailable."),
    ),
    readReleaseEvidence(inventory.targets, github, signal),
  ]);
  signal?.throwIfAborted();
  if (dashboard?.truncated === true) {
    warnings.push(
      "Dependency Dashboard tracking status is truncated. Candidate discovery uses the full lookup report.",
    );
  }
  if ((dashboard?.lookupWarnings.length ?? 0) > 0) {
    warnings.push(
      "The Dependency Dashboard reported additional lookup warnings.",
    );
  }
  if (releases.failed > 0) {
    warnings.push(
      `Release notes could not be read for ${String(releases.failed)} upstream repositories.`,
    );
  }
  return RenovateRankingSnapshotSchema.parse({
    scannedAt: scannedAt.toISOString(),
    baseSha,
    coverage: inventory.incompleteLookups > 0 ? "partial" : "complete",
    warnings: warnings.sort(),
    candidates: rankLookupTargets(inventory.targets, {
      dashboard: dashboard ?? undefined,
      deltas: deltas ?? {},
      advisories: advisories ?? new Map(),
      releases: releases.evidence,
    }),
  });
}

export async function rankRenovateUpdates(): Promise<RenovateRankingSnapshot> {
  const temp = await mkdtemp(path.join(tmpdir(), "renovate-ranking-"));
  const signal = activityCancellationSignalOrUndefined();
  const heartbeat = setInterval(() => {
    safeHeartbeat({ phase: "ranking" });
  }, 15_000);
  try {
    return await collectRenovateRanking(temp, signal);
  } finally {
    clearInterval(heartbeat);
    await rm(temp, { recursive: true, force: true });
  }
}
