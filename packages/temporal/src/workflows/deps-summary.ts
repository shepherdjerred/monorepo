import { rethrowReportDeliveryFailure } from "#workflows/scout/report-delivery.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { patched, proxyActivities } from "@temporalio/workflow";
import { graphemePrefix } from "@shepherdjerred/text";
import type {
  DependencyCollectionResult,
  DepsSummaryActivities,
} from "#activities/maintenance/deps-summary/deps-summary.ts";
import type {
  DependencyChange,
  ReleaseNote,
} from "#shared/deps-summary-types.ts";
import type {
  MissingReleaseNote,
  ReleaseNotesResult,
} from "#activities/maintenance/deps-summary/deps-summary-release-notes.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import type { ReportRemediationV1 } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./scout/report-activity-queue.ts";

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

const { proposeMissingReleaseNoteOverrides } =
  proxyActivities<DepsSummaryActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "90 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "1 minute",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

const { advanceDependencySummaryCheckpoint } =
  proxyActivities<DepsSummaryActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "1 minute",
    retry: RETRY,
  });

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
  if (change.kind === "upstream-upgrade") {
    return "Upstream upgrades";
  }
  return change.kind === "internal-promotion"
    ? "Internal image and digest promotions"
    : "Additions, removals, and reverts";
}

function mergeResolvedReleaseNotes(
  changes: readonly DependencyChange[],
  existingNotes: readonly ReleaseNote[],
  resolvedNotes: readonly ReleaseNote[],
  missing: readonly MissingReleaseNote[],
): ReleaseNotesResult {
  if (resolvedNotes.length === 0) {
    return { notes: [...existingNotes], missing: [...missing] };
  }
  const byKey = new Map<string, ReleaseNote>();
  for (const note of existingNotes) {
    byKey.set(`${note.dependency}\u{0}${note.version}`, note);
  }
  const resolvedVersionKeys = new Set<string>();
  for (const note of resolvedNotes) {
    const key = `${note.dependency}\u{0}${note.version}`;
    if (!byKey.has(key)) {
      byKey.set(key, note);
    }
    resolvedVersionKeys.add(key);
  }
  const versionByCommitKey = new Map(
    changes.map((change) => [
      `${change.name}\u{0}${change.commitSha}`,
      change.newVersion ?? "removed",
    ]),
  );
  return {
    notes: [...byKey.values()],
    missing: missing.filter((candidate) => {
      const version = versionByCommitKey.get(
        `${candidate.dependency}\u{0}${candidate.commitSha}`,
      );
      return (
        version === undefined ||
        !resolvedVersionKeys.has(`${candidate.dependency}\u{0}${version}`)
      );
    }),
  };
}

function extractWorkflowCauseMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error ? error.cause.message : error.message;
  }
  return String(error);
}

async function resolveReleaseNotesWithOptionalPr(
  changes: DependencyChange[],
  fetchedNotes: ReleaseNotesResult,
): Promise<{
  effectiveNotes: ReleaseNotesResult;
  remediation: ReportRemediationV1 | undefined;
}> {
  if (
    fetchedNotes.missing.length === 0 ||
    !patched("deps-summary-release-notes-pr-v1")
  ) {
    return { effectiveNotes: fetchedNotes, remediation: undefined };
  }
  try {
    const proposal = await proposeMissingReleaseNoteOverrides(
      changes,
      fetchedNotes.missing,
    );
    return {
      effectiveNotes: mergeResolvedReleaseNotes(
        changes,
        fetchedNotes.notes,
        proposal.resolvedNotes,
        fetchedNotes.missing,
      ),
      remediation: proposal.remediation,
    };
  } catch (error) {
    return {
      effectiveNotes: fetchedNotes,
      remediation: {
        outcome: "partial",
        changedFiles: [],
        resolvedCount: 0,
        unresolvedCount: fetchedNotes.missing.length,
        summary:
          `Automated release-note override proposal failed: ${extractWorkflowCauseMessage(error)}`.slice(
            0,
            500,
          ),
      },
    };
  }
}

function buildReleaseNoteRemediationEvidence(
  observedAt: string,
  remediation: ReportRemediationV1 | undefined,
): ActivityReportInput["evidence"] {
  if (remediation === undefined || remediation.outcome === "skipped") {
    return [];
  }
  const failed =
    remediation.outcome === "partial" && remediation.prUrl === undefined;
  return [
    {
      id: "release-note-remediation",
      source: "Codex SDK catalog release-note override proposal",
      observedAt,
      status: failed ? "failure" : "success",
      ...(remediation.prUrl === undefined ? {} : { url: remediation.prUrl }),
      excerpt: (remediation.summary ?? remediation.outcome).slice(0, 2000),
    },
  ];
}

function buildDependencyFindings(
  changes: readonly DependencyChange[],
  notes: readonly ReleaseNote[],
): ActivityReportInput["findings"] {
  const notesByChange = new Map(
    notes.map((note) => [`${note.dependency}\u{0}${note.version}`, note]),
  );
  return changes.map((change) => {
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
          : `${graphemePrefix(note.notes, 1000)}${note.url === undefined ? "" : ` (${note.url})`}`,
      evidenceReceiptIds: ["catalog-diff", "release-note-resolution"],
    };
  });
}

function buildDependencySummaryChecks(
  collection: DependencyCollectionResult,
  effectiveNotes: ReleaseNotesResult,
): ActivityReportInput["checks"] {
  const hasChanges = collection.changes.length > 0;
  const notesComplete = effectiveNotes.missing.length === 0;
  return [
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
      status: hasChanges ? (notesComplete ? "passed" : "failed") : "skipped",
      summary: hasChanges
        ? `${effectiveNotes.notes.length.toString()} resolved, ${effectiveNotes.missing.length.toString()} unavailable`
        : "No changed entries require release notes",
      evidenceReceiptIds: hasChanges ? ["release-note-resolution"] : [],
    },
  ];
}

function buildDependencySummaryReport(input: {
  startedAt: string;
  observedAt: string;
  daysBack: number;
  collection: DependencyCollectionResult;
  effectiveNotes: ReleaseNotesResult;
  synthesis: string | undefined;
  remediation: ReportRemediationV1 | undefined;
}): ActivityReportInput {
  const { collection, effectiveNotes, remediation } = input;
  const hasChanges = collection.changes.length > 0;
  const notesComplete = effectiveNotes.missing.length === 0;
  const verdict = hasChanges
    ? "changed"
    : collection.endpointStatesIdentical
      ? "clear"
      : "inconclusive";

  return {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    scheduleId: "deps-summary-weekly",
    startedAt: input.startedAt,
    execution: notesComplete ? "complete" : "partial",
    verdict,
    headline: hasChanges
      ? `${collection.changes.length.toString()} catalog events from ${collection.baseSha.slice(0, 12)} to ${collection.headSha.slice(0, 12)}.`
      : "Catalog states are identical at the last accepted checkpoint and current origin/main.",
    checks: buildDependencySummaryChecks(collection, effectiveNotes),
    evidence: [
      {
        id: "repository-state",
        source: "git origin/main",
        observedAt: input.observedAt,
        status: "success",
        command: "git rev-parse origin/main",
        excerpt: collection.headSha,
      },
      {
        id: "catalog-diff",
        source: "version-catalog.json and legacy versions.ts replay",
        observedAt: input.observedAt,
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
              observedAt: input.observedAt,
              status: notesComplete
                ? ("success" as const)
                : ("failure" as const),
              excerpt: `${effectiveNotes.notes.length.toString()} resolved; ${effectiveNotes.missing.length.toString()} unavailable`,
            },
          ]
        : []),
      ...buildReleaseNoteRemediationEvidence(input.observedAt, remediation),
    ],
    findings: buildDependencyFindings(collection.changes, effectiveNotes.notes),
    limitations: [
      ...effectiveNotes.missing.map((missing) =>
        missingNoteLimitation(missing),
      ),
      ...(remediation?.outcome === "partial" &&
      remediation.summary !== undefined
        ? [remediation.summary]
        : []),
    ],
    actions: [
      ...(remediation?.prUrl === undefined
        ? []
        : [
            `Review and merge catalog release-note override PR ${remediation.prUrl}.`,
          ]),
      ...(effectiveNotes.missing.length === 0
        ? []
        : [
            "Add a releaseNotesOverride to the catalog only when an authoritative source is known.",
          ]),
    ],
    ...(input.synthesis === undefined ? {} : { synthesis: input.synthesis }),
    ...(remediation === undefined ? {} : { remediation }),
    provenance: {
      repoSha: collection.headSha,
      source: "shepherdjerred/monorepo origin/main",
      query: collection.usedCheckpoint
        ? `checkpoint ${collection.baseSha}..${collection.headSha}`
        : `${input.daysBack.toString()}-day bootstrap ${collection.baseSha}..${collection.headSha}`,
    },
  };
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
    startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
    retry: REPORT_DELIVERY_ACTIVITY_RETRY,
  });
  const startedAt = new Date().toISOString();
  try {
    const collection = await collectDependencyChanges(daysBack);
    const fetchedNotes = await fetchDependencyReleaseNotes(collection.changes);
    const { effectiveNotes, remediation } =
      await resolveReleaseNotesWithOptionalPr(collection.changes, fetchedNotes);
    const synthesis = await synthesizeDependencyChanges(
      collection.changes,
      effectiveNotes.notes,
    );
    const report = buildDependencySummaryReport({
      startedAt,
      observedAt: new Date().toISOString(),
      daysBack,
      collection,
      effectiveNotes,
      synthesis,
      remediation,
    });
    const delivery = await deliverActivityReport(report);
    if (!("acceptedAt" in delivery)) {
      throw new Error(
        "Dependency summary checkpoint requires accepted mail delivery",
      );
    }
    await advanceDependencySummaryCheckpoint({
      commitSha: collection.headSha,
      reportRunId: delivery.reportRunId,
      acceptedAt: delivery.acceptedAt,
    });
  } catch (error) {
    rethrowReportDeliveryFailure(error);
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
