import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { rootInstallWithoutHooks, installScoutWorkspace } from "./bot-clone.ts";
import {
  changedFilesInPaths,
  openSeasonRefreshPr,
  runCommand,
} from "./scout-season-refresh-git.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const SCOUT_ROOT = "packages/scout-for-lol";
const QUEUE_WINDOWS_PATH = `${SCOUT_ROOT}/packages/data/src/model/queue-windows.json`;
// The ONLY path this job is allowed to stage.
const GENERATED_PATHS = [QUEUE_WINDOWS_PATH];
const BUCKET = "scout-prod";
const LOOKBACK_DAYS = 21;

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

export type ScoutQueueWindowsResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  autoMergeRequested: boolean;
  editCount: number;
  warningCount: number;
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

function buildWarningEmailHtml(report: Report): string {
  const items = report.warnings
    .map(
      (warning) =>
        `<li><strong>${warning.kind}</strong>: ${warning.message}</li>`,
    )
    .join("");
  return [
    "<p>The scout queue-windows watcher found no window edits to make, but",
    "surfaced warnings worth a human look:</p>",
    `<ul>${items}</ul>`,
  ].join("\n");
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

      await rootInstallWithoutHooks(repoDir);
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

      const files = await changedFilesInPaths(repoDir, GENERATED_PATHS);
      if (files.length === 0) {
        if (report.warnings.length > 0) {
          const { recipient, sender } = resolvePostalAddresses();
          await sendPostalEmail({
            to: recipient,
            from: sender,
            subject: "Scout queue-windows watcher: warnings (no edits)",
            htmlBody: buildWarningEmailHtml(report),
            tag: "scout-queue-windows",
          });
          return {
            changedFiles: [],
            branchName: undefined,
            commitHash: undefined,
            prUrl: undefined,
            autoMergeRequested: false,
            editCount: 0,
            warningCount: report.warnings.length,
            outcome: "no-diff-warned",
          };
        }
        return {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          autoMergeRequested: false,
          editCount: 0,
          warningCount: 0,
          outcome: "no-diff",
        };
      }

      const autoMerge = canAutoMerge(report.edits);
      const branch = `chore/scout-queue-windows-${id.slice(0, 8)}`;
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
            },
          );
        } catch (error: unknown) {
          // Non-fatal: the PR still exists and can be merged manually.
          console.error(
            `scout queue-windows PR auto-merge setup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        changedFiles: files,
        branchName: branch,
        commitHash,
        prUrl,
        autoMergeRequested: autoMerge,
        editCount: report.edits.length,
        warningCount: report.warnings.length,
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
