import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";

export const GIT_BACKUP_CONFIG = {
  user: "shepherdjerred",
  excludedRepositories: ["tabdance", "tab-dance/tabdance"] as const,
  organizations: [
    "shepherdjerred-homework",
    "shepherdjerred-minecraft",
    "harding-capstone",
    "sj-omscs",
    "the-storm-mc",
    "Code-Craft-Crew",
  ] as const,
  includeArchived: true,
  includeForks: true,
  includeWiki: true,
  includeIssues: true,
  includeLfs: true,
  keepSnapshots: 10,
} as const;

export type GitBackupConfig = {
  readonly user: string;
  readonly excludedRepositories: readonly string[];
  readonly organizations: readonly string[];
  readonly includeArchived: boolean;
  readonly includeForks: boolean;
  readonly includeWiki: boolean;
  readonly includeIssues: boolean;
  readonly includeLfs: boolean;
  readonly keepSnapshots: number;
};

export type DiscoveredGitRepository = {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly wikiCloneUrl?: string | undefined;
  readonly hasWiki: boolean;
  readonly hasIssues: boolean;
  readonly archived: boolean;
  readonly fork: boolean;
};

export type GitBackupRepoOutcome =
  | {
      readonly owner: string;
      readonly name: string;
      readonly status: "snapshotted" | "unchanged";
      readonly refDigest: string;
      readonly refCount: number;
      readonly snapshotId: string;
      readonly prunedKeysCount: number;
      readonly wikiStatus: "mirrored" | "uninitialized" | "disabled";
    }
  | {
      readonly owner: string;
      readonly name: string;
      readonly status: "failed";
      readonly error: string;
    };

export type GitBackupResult = {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationSeconds: number;
  readonly discoveredCount: number;
  readonly snapshottedCount: number;
  readonly unchangedCount: number;
  readonly failedCount: number;
  readonly prunedKeysCount: number;
  readonly repositories: readonly GitBackupRepoOutcome[];
};

export function isExcludedRepository(
  repo: { owner: string; name: string },
  excluded: readonly string[] = GIT_BACKUP_CONFIG.excludedRepositories,
): boolean {
  const bareLower = repo.name.toLowerCase();
  const fullLower = `${repo.owner}/${repo.name}`.toLowerCase();
  return excluded.some((entry) => {
    const candidate = entry.toLowerCase();
    return candidate === bareLower || candidate === fullLower;
  });
}

function buildSuccessSummaryExcerpt(result: GitBackupResult): string {
  const header = [
    `Discovered: ${String(result.discoveredCount)}`,
    `Snapshotted: ${String(result.snapshottedCount)}`,
    `Unchanged: ${String(result.unchangedCount)}`,
    `Failed: ${String(result.failedCount)}`,
    `Pruned objects: ${String(result.prunedKeysCount)}`,
    `Duration: ${result.durationSeconds.toFixed(1)}s`,
  ].join(" | ");

  const failedLines = result.repositories.flatMap((entry) =>
    entry.status === "failed"
      ? [`FAILED ${entry.owner}/${entry.name}: ${entry.error}`]
      : [],
  );
  const snapshottedLines = result.repositories
    .flatMap((entry) =>
      entry.status === "snapshotted"
        ? [
            `UPDATED ${entry.owner}/${entry.name} -> ${entry.snapshotId} (${String(entry.refCount)} refs)`,
          ]
        : [],
    )
    .slice(0, 25);

  return [header, ...failedLines, ...snapshottedLines]
    .join("\n")
    .slice(0, 2000);
}

export function buildGitBackupReport(
  result: GitBackupResult,
): ActivityReportInput {
  const succeededCount = result.snapshottedCount + result.unchangedCount;
  const allFailed =
    result.discoveredCount === 0 ||
    (result.failedCount > 0 && succeededCount === 0);
  const hasFailures = result.failedCount > 0 || result.discoveredCount === 0;

  const failureFindings: ActivityReportInput["findings"] =
    result.repositories.flatMap((entry) =>
      entry.status === "failed"
        ? [
            {
              id: `git-backup-repo-failed:${entry.owner}/${entry.name}`,
              severity: "warning" as const,
              summary: `Backup failed for ${entry.owner}/${entry.name}`,
              detail: entry.error.slice(0, 500),
              evidenceReceiptIds: ["git-backup-run"],
            },
          ]
        : [],
    );

  const zeroDiscoveryFinding: ActivityReportInput["findings"] =
    result.discoveredCount === 0
      ? [
          {
            id: "git-backup-zero-discovered",
            severity: "critical" as const,
            summary: "Git backup discovered zero repositories",
            detail:
              "Check GIT_BACKUP_GITHUB_TOKEN_FILE permissions and GitHub token expiration.",
            evidenceReceiptIds: ["git-backup-run"],
          },
        ]
      : [];

  return {
    reportType: "git-backup",
    title: "Daily Git repository backup",
    scheduleId: "git-backup-daily",
    startedAt: result.startedAt,
    execution: allFailed ? "failed" : hasFailures ? "partial" : "complete",
    verdict: hasFailures ? "attention" : "clear",
    headline: hasFailures
      ? `Backed up ${String(succeededCount)} of ${String(result.discoveredCount)} repositories (${String(result.failedCount)} failed).`
      : `All ${String(result.discoveredCount)} repositories verified (${String(result.snapshottedCount)} new snapshots, ${String(result.unchangedCount)} unchanged).`,
    checks: [
      {
        id: "github-discovery",
        label: "GitHub repository discovery",
        required: true,
        status: result.discoveredCount > 0 ? "passed" : "failed",
        summary: `Discovered ${String(result.discoveredCount)} repositories across configured user and organizations.`,
        evidenceReceiptIds: ["git-backup-run"],
      },
      {
        id: "mirror-and-s3-snapshots",
        label: "Bare mirror sync and SeaweedFS zstd snapshots",
        required: true,
        status: hasFailures ? "failed" : "passed",
        summary: `${String(result.snapshottedCount)} snapshotted, ${String(result.unchangedCount)} unchanged, ${String(result.failedCount)} failed, ${String(result.prunedKeysCount)} expired snapshot objects pruned.`,
        evidenceReceiptIds: ["git-backup-run"],
      },
    ],
    evidence: [
      {
        id: "git-backup-run",
        source: "git-backup-daily activity",
        observedAt: result.completedAt,
        status: hasFailures ? "failure" : "success",
        excerpt: buildSuccessSummaryExcerpt(result),
      },
    ],
    findings: [...zeroDiscoveryFinding, ...failureFindings],
    limitations: [],
    actions: hasFailures
      ? [
          "Inspect failed repositories in temporal-repo-worker logs and verify GitHub PAT scopes (repo, read:org, read:user).",
        ]
      : [],
    provenance: {
      source: "GitHub REST API + bare git mirrors + SeaweedFS S3 git-backups",
      windowStart: result.startedAt,
      windowEnd: result.completedAt,
    },
  };
}

export function buildGitBackupFailureReport(
  startedAt: string,
  error: unknown,
): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "git-backup",
    title: "Daily Git repository backup",
    scheduleId: "git-backup-daily",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Daily Git repository backup failed before completion.",
    checks: [
      {
        id: "git-backup-execution",
        label: "Daily Git backup execution",
        required: true,
        status: "failed",
        summary: message.slice(0, 500),
        evidenceReceiptIds: ["git-backup-failure"],
      },
    ],
    evidence: [
      {
        id: "git-backup-failure",
        source: "git-backup-daily workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["The backup activity did not complete cleanly."],
    actions: [
      "Inspect temporal-repo-worker logs, SeaweedFS reachability, and GIT_BACKUP_GITHUB_TOKEN_FILE.",
    ],
    provenance: {
      source: "git-backup-daily workflow",
    },
  };
}
