import { patched, proxyActivities } from "@temporalio/workflow";
import type { DepsSummaryActivities } from "#activities/maintenance/deps-summary.ts";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import type { DepsSummaryLegacyActivities } from "#activities/maintenance/deps-summary-legacy.ts";
import type { MissingReleaseNote } from "#activities/maintenance/deps-summary-release-notes.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "30 seconds" as const,
  backoffCoefficient: 2,
  maximumInterval: "5 minutes" as const,
};

const {
  collectDependencyChanges,
  fetchDependencyReleaseNotes,
  synthesizeDependencyChanges,
} = proxyActivities<DepsSummaryActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});

const { advanceDependencySummaryCheckpoint } =
  proxyActivities<DepsSummaryActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "1 minute",
    retry: RETRY,
  });

// Legacy proxies exist solely to reproduce the pre-rewrite command sequence for
// an execution still open across the rollout. Their timeouts must stay exactly
// as they were when those histories were written.
const { cloneAndGetVersionChanges, fetchReleaseNotes } =
  proxyActivities<DepsSummaryLegacyActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "60 seconds",
    retry: RETRY,
  });

const { summarizeWithLLM } = proxyActivities<DepsSummaryLegacyActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "3 minutes",
  retry: RETRY,
});

const { formatAndSendEmail } = proxyActivities<DepsSummaryLegacyActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "1 minute",
  retry: RETRY,
});

async function runLegacyDependencySummary(daysBack: number): Promise<void> {
  const changes = await cloneAndGetVersionChanges(daysBack);
  if (changes.length === 0) {
    await formatAndSendEmail([], "", []);
    return;
  }
  const releaseNotesResult = await fetchReleaseNotes(changes);
  const summary = await summarizeWithLLM(changes, releaseNotesResult.notes);
  await formatAndSendEmail(changes, summary, releaseNotesResult.failed);
}

function changeSummary(change: DependencyChange): string {
  const oldValue = change.oldValue ?? "not present";
  const newValue = change.newValue ?? "removed";
  return `${change.name}: ${oldValue} -> ${newValue} (${change.kind}, ${change.commitSha.slice(0, 12)})`;
}

function missingNoteLimitation(missing: MissingReleaseNote): string {
  const attempts = missing.attempts
    .map((attempt) => `${attempt.source}=${attempt.outcome}: ${attempt.detail}`)
    .join("; ");
  return `${missing.dependency}: release notes unavailable after ${attempts}`;
}

function dependencySection(change: DependencyChange): string {
  if (change.kind === "upstream-upgrade") return "Upstream upgrades";
  if (change.kind === "internal-promotion") {
    return "Internal image and digest promotions";
  }
  return "Additions, removals, and reverts";
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    scheduleId: "deps-summary-weekly",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Dependency collection failed; no no-change conclusion was made.",
    checks: [
      {
        id: "dependency-collection",
        label: "Repository and catalog collection",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["collection-failure"],
      },
    ],
    evidence: [
      {
        id: "collection-failure",
        source: "dependency-summary-workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "The repository or an upstream evidence source was unavailable.",
    ],
    actions: ["Inspect the failed Temporal activity and rerun the schedule."],
    provenance: {
      source: "shepherdjerred/monorepo origin/main",
      query: "last accepted dependency checkpoint through current origin/main",
    },
  };
}

export async function generateDependencySummary(
  daysBack = 7,
  reportTaskQueue?: string,
): Promise<void> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(reportTaskQueue),
    startToCloseTimeout: "2 minutes",
    retry: RETRY,
  });
  if (!patched("deps-summary-evidence-v1")) {
    return runLegacyDependencySummary(daysBack);
  }
  const startedAt = new Date().toISOString();
  try {
    const collection = await collectDependencyChanges(daysBack);
    const releaseNotes = await fetchDependencyReleaseNotes(collection.changes);
    const synthesis = await synthesizeDependencyChanges(
      collection.changes,
      releaseNotes.notes,
    );
    const observedAt = new Date().toISOString();
    const hasChanges = collection.changes.length > 0;
    const notesComplete = releaseNotes.missing.length === 0;
    const notesByChange = new Map(
      releaseNotes.notes.map((note) => [
        `${note.dependency}\u{0}${note.version}`,
        note,
      ]),
    );
    const execution = notesComplete ? "complete" : "partial";
    const report: ActivityReportInput = {
      reportType: "dependency-summary",
      title: "Weekly dependency summary",
      scheduleId: "deps-summary-weekly",
      startedAt,
      execution,
      verdict: hasChanges
        ? "changed"
        : collection.endpointStatesIdentical
          ? "clear"
          : "inconclusive",
      headline: hasChanges
        ? `${collection.changes.length.toString()} catalog events from ${collection.baseSha.slice(0, 12)} to ${collection.headSha.slice(0, 12)}.`
        : "Catalog states are identical at the last accepted checkpoint and current origin/main.",
      checks: [
        {
          id: "repository-access",
          label: "Repository access",
          required: true,
          status: "passed",
          summary: `Read origin/main at ${collection.headSha}`,
          evidenceReceiptIds: ["repository-state"],
        },
        {
          id: "catalog-diff",
          label: "Chronological catalog diff",
          required: true,
          status: "passed",
          summary: `${collection.changes.length.toString()} events; endpoint states ${collection.endpointStatesIdentical ? "identical" : "different"}`,
          evidenceReceiptIds: ["catalog-diff"],
        },
        {
          id: "release-notes",
          label: "Release-note resolution",
          required: hasChanges,
          status: hasChanges
            ? notesComplete
              ? "passed"
              : "failed"
            : "skipped",
          summary: hasChanges
            ? `${releaseNotes.notes.length.toString()} resolved, ${releaseNotes.missing.length.toString()} unavailable`
            : "No changed entries require release notes",
          evidenceReceiptIds: hasChanges ? ["release-note-resolution"] : [],
        },
      ],
      evidence: [
        {
          id: "repository-state",
          source: "git origin/main",
          observedAt,
          status: "success",
          command: `git rev-parse origin/main`,
          excerpt: collection.headSha,
        },
        {
          id: "catalog-diff",
          source: "version-catalog.json and legacy versions.ts replay",
          observedAt,
          status: "success",
          command: `git rev-list --reverse ${collection.baseSha}..${collection.headSha}`,
          excerpt:
            collection.changes.length === 0
              ? "No catalog events"
              : collection.changes
                  .slice(0, 20)
                  .map((change) => changeSummary(change))
                  .join("\n")
                  .slice(0, 2000),
        },
        ...(hasChanges
          ? [
              {
                id: "release-note-resolution",
                source: "merged PR, datasource metadata, and catalog overrides",
                observedAt,
                status: notesComplete
                  ? ("success" as const)
                  : ("failure" as const),
                excerpt: `${releaseNotes.notes.length.toString()} resolved; ${releaseNotes.missing.length.toString()} unavailable`,
              },
            ]
          : []),
      ],
      findings: collection.changes.map((change) => {
        const note = notesByChange.get(
          `${change.name}\u{0}${change.newVersion ?? "removed"}`,
        );
        return {
          section: dependencySection(change),
          severity:
            change.kind === "removal" || change.kind === "revert"
              ? ("warning" as const)
              : ("info" as const),
          summary: changeSummary(change),
          detail:
            note === undefined
              ? change.commitSubject
              : `${note.notes.slice(0, 1000)}${note.url === undefined ? "" : ` (${note.url})`}`,
          evidenceReceiptIds: ["catalog-diff", "release-note-resolution"],
        };
      }),
      limitations: releaseNotes.missing.map((missing) =>
        missingNoteLimitation(missing),
      ),
      actions:
        releaseNotes.missing.length === 0
          ? []
          : [
              "Add a releaseNotesOverride to the catalog only when an authoritative source is known.",
            ],
      ...(synthesis === undefined ? {} : { synthesis }),
      provenance: {
        repoSha: collection.headSha,
        source: "shepherdjerred/monorepo origin/main",
        query: collection.usedCheckpoint
          ? `checkpoint ${collection.baseSha}..${collection.headSha}`
          : `${daysBack.toString()}-day bootstrap ${collection.baseSha}..${collection.headSha}`,
      },
    };
    const delivery = await deliverActivityReport(report);
    await advanceDependencySummaryCheckpoint({
      commitSha: collection.headSha,
      reportRunId: delivery.reportRunId,
      acceptedAt: delivery.acceptedAt,
    });
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
