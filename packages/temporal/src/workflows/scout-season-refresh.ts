import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  ScoutSeasonRefreshActivities,
  ScoutSeasonRefreshInput,
  ScoutSeasonRefreshResult,
} from "#activities/scout-season-refresh.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";

const { runScoutSeasonRefresh } = proxyActivities<ScoutSeasonRefreshActivities>(
  {
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "5 minutes",
      backoffCoefficient: 2,
      maximumInterval: "15 minutes",
    },
  },
);
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

type SeasonReportState = {
  proposalComplete: boolean;
  complete: boolean;
  changed: boolean;
};

function seasonReportState(
  result: ScoutSeasonRefreshResult,
): SeasonReportState {
  const proposalComplete =
    result.outcome !== "pr-created" || result.prUrl !== undefined;
  return {
    proposalComplete,
    complete:
      result.sourceEvidenceComplete &&
      result.sentinelAgreement &&
      result.validationPassed &&
      proposalComplete,
    changed:
      result.outcome === "pr-created" ||
      result.outcome === "pr-skipped-dry-run",
  };
}

function seasonHeadline(
  result: ScoutSeasonRefreshResult,
  state: SeasonReportState,
): string {
  if (!state.complete)
    return `Season refresh is inconclusive: ${result.reason}.`;
  if (state.changed) {
    const publication = result.prUrl === undefined ? "" : " and opened a PR";
    return `Validated season drift in ${result.changedFiles.length.toString()} files${publication}.`;
  }
  return "Two independent sources, the repository diff, and season tests agree that no update is needed.";
}

function seasonChecks(
  result: ScoutSeasonRefreshResult,
  state: SeasonReportState,
): ActivityReportInput["checks"] {
  const proposalRequired = result.outcome === "pr-created";
  return [
    {
      id: "source-evidence",
      label: "Independent season sources",
      required: true,
      status: result.sourceEvidenceComplete ? "passed" : "failed",
      summary: result.sourceEvidenceComplete
        ? `${result.requiredDates.length.toString()} date claims corroborated by both Riot and wiki content`
        : `${result.unsupportedDates.length.toString()} of ${result.requiredDates.length.toString()} date claims lack two-family corroboration`,
      evidenceReceiptIds: ["source-evidence"],
    },
    {
      id: "source-diff-agreement",
      label: "Source sentinel and deterministic diff agreement",
      required: true,
      status: result.sentinelAgreement ? "passed" : "failed",
      summary: result.sentinelAgreement
        ? "Source conclusion agrees with the diff"
        : "Source conclusion disagrees with the diff",
      evidenceReceiptIds: ["sentinel-diff"],
    },
    {
      id: "season-tests",
      label: "Season data tests",
      required: true,
      status: result.validationPassed ? "passed" : "failed",
      summary: result.validationPassed
        ? "bun run test -- src/seasons.test.ts passed"
        : "Season tests did not pass",
      evidenceReceiptIds: ["season-tests"],
    },
    {
      id: "proposal",
      label: "Season update proposal",
      required: proposalRequired,
      status: proposalRequired
        ? state.proposalComplete
          ? "passed"
          : "failed"
        : "skipped",
      summary: result.prUrl ?? "No PR required",
      evidenceReceiptIds: proposalRequired ? ["sentinel-diff"] : [],
    },
  ];
}

function seasonEvidence(
  result: ScoutSeasonRefreshResult,
  observedAt: string,
): ActivityReportInput["evidence"] {
  const sourceExcerpt = JSON.stringify({
    urls: result.sourceUrls,
    requiredDates: result.requiredDates,
    unsupportedDates: result.unsupportedDates,
  });
  return [
    {
      id: "source-evidence",
      source:
        "Independently fetched Riot and League season sources cited by the research phase",
      observedAt,
      status: result.sourceEvidenceComplete ? "success" : "failure",
      excerpt: sourceExcerpt.slice(0, 2000),
    },
    {
      id: "sentinel-diff",
      source: "Agent sentinel compared with allowlisted git diff",
      observedAt,
      status: result.sentinelAgreement ? "success" : "failure",
      ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
      excerpt: JSON.stringify({
        outcome: result.outcome,
        changedFiles: result.changedFiles,
        sentinelAgreement: result.sentinelAgreement,
      }),
    },
    {
      id: "season-tests",
      source: "Scout season test command",
      observedAt,
      status: result.validationPassed ? "success" : "failure",
      command:
        "cd packages/scout-for-lol/packages/data && bun run test -- src/seasons.test.ts",
      excerpt: result.validationPassed ? "passed" : "failed",
    },
  ];
}

function seasonFindings(
  result: ScoutSeasonRefreshResult,
  state: SeasonReportState,
): ActivityReportInput["findings"] {
  return [
    ...(state.changed
      ? [
          {
            severity: "info" as const,
            summary: `Season schedule changed in ${result.changedFiles.length.toString()} files`,
            ...(result.prUrl === undefined ? {} : { detail: result.prUrl }),
            evidenceReceiptIds: ["sentinel-diff", "source-evidence"],
          },
        ]
      : []),
    ...(state.complete
      ? []
      : [
          {
            severity: "warning" as const,
            summary: result.reason,
            evidenceReceiptIds: ["sentinel-diff", "source-evidence"],
          },
        ]),
  ];
}

export function scoutSeasonReport(
  startedAt: string,
  result: ScoutSeasonRefreshResult,
): ActivityReportInput {
  const state = seasonReportState(result);
  const observedAt = new Date().toISOString();
  return {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    scheduleId: "scout-season-refresh-weekly",
    startedAt,
    execution: state.complete ? "complete" : "partial",
    verdict: state.complete
      ? state.changed
        ? "changed"
        : "clear"
      : "inconclusive",
    headline: seasonHeadline(result, state),
    checks: seasonChecks(result, state),
    evidence: seasonEvidence(result, observedAt),
    findings: seasonFindings(result, state),
    limitations: state.complete ? [] : [result.reason],
    actions: state.complete
      ? state.changed
        ? ["Review the season refresh PR."]
        : []
      : [
          "Review source availability and sentinel/diff disagreement; do not treat this run as clean.",
        ],
    provenance: {
      source: "Riot/League sources and shepherdjerred/monorepo main",
      query: "current and upcoming League season/act dates",
    },
  };
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    scheduleId: "scout-season-refresh-weekly",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Scout season refresh failed.",
    checks: [
      {
        id: "season-refresh-run",
        label: "Season source, diff, and test validation",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["season-refresh-failure"],
      },
    ],
    evidence: [
      {
        id: "season-refresh-failure",
        source: "Scout season refresh workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Source, diff, test, or proposal evidence is incomplete."],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "Scout season refresh workflow" },
  };
}

export async function runScoutSeasonRefreshWorkflow(
  input: ScoutSeasonRefreshInput = {},
): Promise<ScoutSeasonRefreshResult> {
  const startedAt = new Date().toISOString();
  try {
    const result = await runScoutSeasonRefresh(input);
    if (patched("scout-season-report-envelope-v1")) {
      await deliverActivityReport(scoutSeasonReport(startedAt, result));
    }
    return result;
  } catch (error) {
    if (patched("scout-season-report-envelope-v1")) {
      await deliverActivityReport(failureReport(startedAt, error));
    }
    throw error;
  }
}
