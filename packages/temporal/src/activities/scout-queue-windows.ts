import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS } from "#shared/scout-queue-windows-lookback.ts";
import { installScoutWorkspace } from "./bot-clone.ts";
import {
  changedFilesInPaths,
  closeSeasonRefreshPr,
  openSeasonRefreshPr,
  runCommand,
} from "./scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const SCOUT_ROOT = "packages/scout-for-lol";
const QUEUE_WINDOWS_PATH = `${SCOUT_ROOT}/packages/data/src/model/queue-windows.json`;
// The ONLY path this job is allowed to stage.
const GENERATED_PATHS = [QUEUE_WINDOWS_PATH];
const BUCKET = "scout-prod";
const LOOKBACK_DAYS = SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS;
const PROPOSAL_BRANCH = "chore/scout-queue-windows";
const WARNING_STATE_KEY = "reports/state/scout-queue-windows.json";
const AutoMergeStateSchema = z.enum(["true", "false"]);

const ReportEditSchema = z.object({
  queue: z.string(),
  kind: z.enum(["open", "reopen", "close"]),
  date: z.string(),
  message: z.string(),
});
const ReportWarningSchema = z.object({
  kind: z.string(),
  message: z.string(),
});
const ReportPatchNotesSchema = z.union([
  z.object({
    titles: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  z.object({ error: z.string() }),
]);
const ReportSchema = z.object({
  edits: z.array(ReportEditSchema),
  warnings: z.array(ReportWarningSchema),
  unknownQueueIds: z.array(
    z.object({ queueId: z.string(), total: z.number() }),
  ),
  patchNotes: ReportPatchNotesSchema,
});
type Report = z.infer<typeof ReportSchema>;
const WarningStateSchema = z.object({
  schemaVersion: z.literal(1),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  consecutiveRuns: z.number().int().nonnegative(),
  // Optional so state written before retry-aware counting remains readable.
  lastWorkflowRunId: z.string().min(1).optional(),
});
type WarningState = z.infer<typeof WarningStateSchema>;

export type ScoutQueueWindowsResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  autoMergeRequested: boolean;
  autoMergeConfigured: boolean | undefined;
  editCount: number;
  warningCount: number;
  warningSummaries: string[];
  warningFingerprint: string | undefined;
  warningConsecutiveRuns: number;
  editSummaries: string[];
  outcome: "pr-created" | "no-diff" | "no-diff-warned";
};

function resolveS3Region(): string {
  return (
    Bun.env["AWS_REGION"] ??
    Bun.env["AWS_DEFAULT_REGION"] ??
    Bun.env["S3_REGION"] ??
    "us-east-1"
  );
}

/** Auto-merge is safe only when every edit merely opens/reopens a window. A
 * close retires a live mode and must be confirmed against patch notes. */
function canAutoMerge(edits: readonly Report["edits"][number][]): boolean {
  return edits.length > 0 && edits.every((edit) => edit.kind !== "close");
}

function buildPrBody(report: Report, autoMerge: boolean): string {
  const lines: string[] = [
    "Automated queue-windows update from Temporal (`scout-queue-windows-daily`).",
    "",
    "Proposed from real match volume in the last",
    `${LOOKBACK_DAYS.toString()} days against the ${BUCKET} bucket.`,
    "",
    "## Edits",
    "",
    "| Queue | Kind | Date | Detail |",
    "| --- | --- | --- | --- |",
    ...report.edits.map(
      (edit) =>
        `| ${edit.queue} | ${edit.kind} | ${edit.date} | ${edit.message} |`,
    ),
  ];

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const warning of report.warnings) {
      lines.push(`- **${warning.kind}**: ${warning.message}`);
    }
  }

  lines.push("", "## Patch notes", "");
  if ("error" in report.patchNotes) {
    lines.push(`- Patch notes unavailable: ${report.patchNotes.error}`);
  } else if (report.patchNotes.titles.length === 0) {
    lines.push("- No recent patch notes found.");
  } else {
    for (const note of report.patchNotes.titles) {
      lines.push(`- [${note.title}](${note.url})`);
    }
  }

  lines.push("");
  if (autoMerge) {
    lines.push(
      "Auto-merge enabled: every edit only opens/reopens a window (additive, reversible).",
    );
  } else {
    lines.push(
      "Auto-merge NOT enabled: this PR closes a window (retires a live mode).",
      "A human must confirm the close against the patch notes above before merging.",
    );
  }
  return lines.join("\n");
}

function warningStateStore(
  endpoint: string,
  region: string,
): {
  client: S3Client;
  bucket: string;
} {
  return {
    client: new S3Client({ endpoint, region, forcePathStyle: true }),
    bucket:
      Bun.env["REPORT_RECEIPT_BUCKET"] ??
      Bun.env["REVIEW_SIGNAL_ARCHIVE_BUCKET"] ??
      "llm-archive",
  };
}

async function readWarningState(
  client: S3Client,
  bucket: string,
): Promise<WarningState | undefined> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: WARNING_STATE_KEY }),
    );
    if (result.Body === undefined) {
      throw new Error("queue warning state has no body");
    }
    return WarningStateSchema.parse(
      JSON.parse(await result.Body.transformToString()),
    );
  } catch (error: unknown) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return undefined;
    }
    throw error;
  }
}

export function nextWarningState(
  prior: WarningState | undefined,
  fingerprint: string | undefined,
  workflowRunId: string,
): WarningState {
  const consecutiveRuns =
    fingerprint === undefined
      ? 0
      : prior?.fingerprint === fingerprint
        ? prior.lastWorkflowRunId === workflowRunId
          ? prior.consecutiveRuns
          : prior.consecutiveRuns + 1
        : 1;
  return WarningStateSchema.parse({
    schemaVersion: 1,
    fingerprint: fingerprint ?? null,
    consecutiveRuns,
    lastWorkflowRunId: workflowRunId,
  });
}

async function warningFingerprint(
  warnings: Report["warnings"],
): Promise<string | undefined> {
  if (warnings.length === 0) return undefined;
  const canonical = warnings
    .map((warning) => `${warning.kind}\0${warning.message}`)
    .sort()
    .join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function updateWarningState(
  endpoint: string,
  region: string,
  warnings: Report["warnings"],
): Promise<{ fingerprint: string | undefined; consecutiveRuns: number }> {
  const store = warningStateStore(endpoint, region);
  const [prior, fingerprint] = await Promise.all([
    readWarningState(store.client, store.bucket),
    warningFingerprint(warnings),
  ]);
  const workflowExecution = Context.current().info.workflowExecution;
  if (workflowExecution === undefined) {
    throw new Error("Scout queue warning state requires a workflow execution");
  }
  const state = nextWarningState(prior, fingerprint, workflowExecution.runId);
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: WARNING_STATE_KEY,
      Body: JSON.stringify(state, null, 2),
      ContentType: "application/json; charset=utf-8",
    }),
  );
  return {
    fingerprint: state.fingerprint ?? undefined,
    consecutiveRuns: state.consecutiveRuns,
  };
}

function resultDetails(
  report: Report,
  warningState: { fingerprint: string | undefined; consecutiveRuns: number },
): Pick<
  ScoutQueueWindowsResult,
  | "editCount"
  | "warningCount"
  | "warningSummaries"
  | "warningFingerprint"
  | "warningConsecutiveRuns"
  | "editSummaries"
> {
  return {
    editCount: report.edits.length,
    warningCount: report.warnings.length,
    warningSummaries: report.warnings.map(
      (warning) => `${warning.kind}: ${warning.message}`,
    ),
    warningFingerprint: warningState.fingerprint,
    warningConsecutiveRuns: warningState.consecutiveRuns,
    editSummaries: report.edits.map(
      (edit) => `${edit.queue}: ${edit.kind} ${edit.date} — ${edit.message}`,
    ),
  };
}

export type ScoutQueueWindowsActivities = typeof scoutQueueWindowsActivities;

export const scoutQueueWindowsActivities = {
  /**
   * Scan recent scout-prod match volume, propose limited-queue availability
   * window edits into `queue-windows.json`, and open a PR on drift.
   * Deterministic (no agent). Auto-merges open/reopen-only PRs; any close is
   * left for human confirmation against Riot patch notes.
   */
  async refreshScoutQueueWindows(): Promise<ScoutQueueWindowsResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/scout-queue-windows-${id}`;
    const repoDir = `${tempDir}/monorepo`;
    const reportPath = `${tempDir}/queue-windows-report.json`;

    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshScoutQueueWindows",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const s3Endpoint = Bun.env["S3_ENDPOINT"];
      if (s3Endpoint === undefined || s3Endpoint === "") {
        throw new Error(
          "S3_ENDPOINT is required for the scout queue-windows watcher (SeaweedFS endpoint for the scout-prod bucket)",
        );
      }

      const { token: githubToken } = await createGitHubAppInstallationToken();
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--depth",
        "1",
      ]);

      await installScoutWorkspace(repoDir);

      const region = resolveS3Region();
      await runCommand(
        [
          "bun",
          "run",
          "--filter=./packages/backend",
          "update-queue-windows",
          "--",
          "--bucket",
          BUCKET,
          "--lookback-days",
          LOOKBACK_DAYS.toString(),
          "--report",
          reportPath,
          "--endpoint-url",
          s3Endpoint,
        ],
        {
          cwd: `${repoDir}/${SCOUT_ROOT}`,
          // S3 env parity with the lane-priors CLI: creds come from the pod's
          // AWS_* env; region + endpoint are passed explicitly, and ENVIRONMENT
          // is cleared so scout's env-var validation doesn't reject the pod's
          // ENVIRONMENT=production.
          env: {
            AWS_REGION: region,
            AWS_DEFAULT_REGION: region,
            ENVIRONMENT: undefined,
          },
        },
      );

      const rawReport: unknown = await Bun.file(reportPath).json();
      const report = ReportSchema.parse(rawReport);
      const warningState = await updateWarningState(
        s3Endpoint,
        region,
        report.warnings,
      );
      const details = resultDetails(report, warningState);

      const files = await changedFilesInPaths(repoDir, GENERATED_PATHS);
      if (files.length === 0) {
        // Fresh match evidence can invalidate a close proposal that is still
        // awaiting human review. Reconcile the shared branch's open PR before
        // returning so an obsolete close cannot be merged after drift vanished.
        await closeSeasonRefreshPr({
          repoDir,
          branch: PROPOSAL_BRANCH,
          ghToken: githubToken,
          repoSlug: REPO_SLUG,
          reason:
            "Closing this automated proposal because the latest scout-prod evidence produces no queue-window drift. A future drift run will open a fresh proposal.",
        });
        if (report.warnings.length > 0) {
          return {
            changedFiles: [],
            branchName: undefined,
            commitHash: undefined,
            prUrl: undefined,
            autoMergeRequested: false,
            autoMergeConfigured: undefined,
            ...details,
            outcome: "no-diff-warned",
          };
        }
        return {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          autoMergeRequested: false,
          autoMergeConfigured: undefined,
          ...details,
          outcome: "no-diff",
        };
      }

      const autoMerge = canAutoMerge(report.edits);
      let autoMergeConfigured: boolean | undefined;
      // All daily runs reuse one proposal branch. A close proposal needs human
      // review and may outlive a schedule interval; reopening it updates the
      // same PR rather than generating a duplicate each day. The shared Git
      // helper fetches the branch before its force-with-lease push, so retries
      // and later runs retain the remote lease.
      const branch = PROPOSAL_BRANCH;
      const title = "chore(scout-for-lol): update queue availability windows";
      const body = buildPrBody(report, autoMerge);

      const { commitHash, prUrl } = await openSeasonRefreshPr({
        repoDir,
        tempDir,
        branch,
        title,
        body,
        files: GENERATED_PATHS,
        ghToken: githubToken,
        repoSlug: REPO_SLUG,
        mainBranch: MAIN_BRANCH,
      });

      if (autoMerge) {
        try {
          await runCommand(
            [
              "gh",
              "pr",
              "merge",
              "--repo",
              REPO_SLUG,
              "--auto",
              "--merge",
              prUrl,
            ],
            {
              cwd: repoDir,
              env: { GH_TOKEN: githubToken },
              redactOutput: true,
              operation: "pr-enable-auto-merge",
            },
          );
          autoMergeConfigured = true;
        } catch (error: unknown) {
          // Non-fatal: the PR still exists and can be merged manually.
          console.error(
            `scout queue-windows PR auto-merge setup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          autoMergeConfigured = false;
        }
      } else {
        // A shared proposal may previously have contained only additive edits
        // and therefore have auto-merge armed. If later evidence turns that
        // same PR into a close proposal, disable auto-merge before returning it
        // for required human confirmation.
        const autoMergeState = AutoMergeStateSchema.parse(
          await runCommand(
            [
              "gh",
              "pr",
              "view",
              prUrl,
              "--repo",
              REPO_SLUG,
              "--json",
              "autoMergeRequest",
              "--jq",
              ".autoMergeRequest != null",
            ],
            {
              cwd: repoDir,
              env: { GH_TOKEN: githubToken },
              redactOutput: true,
              operation: "pr-read-auto-merge",
            },
          ),
        );
        if (autoMergeState === "true") {
          await runCommand(
            ["gh", "pr", "merge", prUrl, "--repo", REPO_SLUG, "--disable-auto"],
            {
              cwd: repoDir,
              env: { GH_TOKEN: githubToken },
              redactOutput: true,
              operation: "pr-disable-auto-merge",
            },
          );
        }
        autoMergeConfigured = true;
      }

      return {
        changedFiles: files,
        branchName: branch,
        commitHash,
        prUrl,
        autoMergeRequested: autoMerge,
        autoMergeConfigured,
        ...details,
        outcome: "pr-created",
      };
    } finally {
      clearInterval(heartbeat);
      try {
        await runCommand(["rm", "-rf", tempDir], { cwd: "/tmp" });
      } catch {
        // best-effort cleanup
      }
    }
  },
};
