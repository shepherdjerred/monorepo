import { z } from "zod/v4";
import { sha256 } from "./homelab-audit-digest.ts";
import type {
  ReportCheckV1,
  ReportEvidenceReceiptV1,
  ReportEnvelopeV1,
} from "#shared/reports/report.ts";

/**
 * Main-branch CI health for the homelab audit.
 *
 * Woodpecker's model is pipeline -> workflow -> step, and its list endpoint
 * returns summaries without workflows, so a pipeline's steps take a second
 * request. The audit only needs enough to say "main is red and here is why",
 * so it flattens workflows into steps and reads the tail of each failed step's
 * log.
 */

const StepSchema = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  state: z.string(),
});

const WorkflowSchema = z.looseObject({
  name: z.string(),
  state: z.string(),
  children: z.array(StepSchema).default([]),
});

const PipelineSummarySchema = z.looseObject({
  number: z.number().int().positive(),
  status: z.string(),
  commit: z.string(),
  created: z.number().int().nonnegative(),
});

const PipelineSummariesSchema = z.array(PipelineSummarySchema);

const PipelineDetailSchema = PipelineSummarySchema.extend({
  workflows: z.array(WorkflowSchema).default([]),
});

/**
 * One log line. `data` is a byte array rather than a string, so it has to be
 * decoded rather than concatenated.
 */
const LogEntrySchema = z.looseObject({
  data: z.array(z.number().int()),
});
const LogSchema = z.array(LogEntrySchema);

type Pipeline = z.infer<typeof PipelineDetailSchema>;
type Finding = ReportEnvelopeV1["findings"][number];
type CollectorResult = {
  check: ReportCheckV1;
  evidence: ReportEvidenceReceiptV1;
  findings: Finding[];
  limitation: string | undefined;
};
export type CiRequest = (path: string) => Promise<unknown>;

const EVIDENCE_ID = "ci-main-evidence";
const CHECK_ID = "ci-main";
const CHECK_LABEL = "CI main pipelines";
const SOURCE = "Woodpecker REST API";

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function ciRequest(path: string): Promise<unknown> {
  const server = requiredEnv("WOODPECKER_URL");
  const token = requiredEnv("WOODPECKER_TOKEN");
  const response = await fetch(`${server}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Woodpecker returned HTTP ${String(response.status)}`);
  }
  return response.json();
}

function repoPath(suffix: string): string {
  return `/api/repos/${requiredEnv("WOODPECKER_REPO_ID")}${suffix}`;
}

function pipelinesPath(since: Date, page: number): string {
  const parameters = new URLSearchParams({
    branch: "main",
    after: since.toISOString(),
    perPage: "50",
    page: page.toString(),
  });
  return repoPath(`/pipelines?${parameters.toString()}`);
}

async function allPipelinesSince(
  since: Date,
  request: CiRequest,
): Promise<Pipeline[]> {
  const numbers: number[] = [];
  let page = 1;
  let current: z.infer<typeof PipelineSummariesSchema>;
  do {
    current = PipelineSummariesSchema.parse(
      await request(pipelinesPath(since, page)),
    );
    // Re-check the window rather than trusting `after`: a server that ignored
    // it would silently widen the audit's 24-hour claim.
    for (const summary of current) {
      if (summary.created * 1000 >= since.getTime()) {
        numbers.push(summary.number);
      }
    }
    page += 1;
  } while (current.length === 50);

  const pipelines: Pipeline[] = [];
  for (const number of numbers) {
    pipelines.push(
      PipelineDetailSchema.parse(
        await request(repoPath(`/pipelines/${number.toString()}`)),
      ),
    );
  }
  return pipelines;
}

/** Statuses that mean the newest pipeline is not green. */
const LATEST_RED_STATUSES = new Set([
  "failure",
  "error",
  "killed",
  "declined",
  "blocked",
]);

function decodeLog(entries: z.infer<typeof LogSchema>): string {
  const bytes = entries.flatMap((entry) => entry.data);
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function failedSteps(
  pipeline: Pipeline,
): { workflow: string; step: z.infer<typeof StepSchema> }[] {
  return pipeline.workflows.flatMap((workflow) =>
    workflow.children
      .filter((step) => step.state === "failure" || step.state === "error")
      .map((step) => ({ workflow: workflow.name, step })),
  );
}

export function ciPipelineFinding(
  pipeline: Pipeline,
  causes: readonly string[],
): Finding {
  const detail = causes
    .filter((cause) =>
      cause.startsWith(`pipeline #${pipeline.number.toString()} `),
    )
    .join("\n")
    .slice(0, 2000);
  return {
    severity: "warning",
    summary: `CI main pipeline #${pipeline.number.toString()} ${pipeline.status}`,
    ...(detail === "" ? {} : { detail }),
    evidenceReceiptIds: [EVIDENCE_ID],
  };
}

export async function collectCiMainWith(input: {
  now: Date;
  request: CiRequest;
  pipelineUrl: (number: number) => string;
}): Promise<CollectorResult> {
  const observedAt = input.now.toISOString();
  const since = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
  try {
    const pipelines = await allPipelinesSince(since, input.request);
    const newestFirst = pipelines.toSorted(
      (left, right) => right.number - left.number,
    );
    const latest = newestFirst[0];
    const failed = pipelines.filter(
      (pipeline) =>
        pipeline.status === "failure" || pipeline.status === "error",
    );
    const latestRed =
      latest !== undefined && LATEST_RED_STATUSES.has(latest.status)
        ? latest
        : undefined;
    const actionable = [
      ...failed,
      ...(latestRed === undefined ||
      latestRed.status === "failure" ||
      latestRed.status === "error"
        ? []
        : [latestRed]),
    ];

    const causes: string[] = [];
    for (const pipeline of failed) {
      for (const { workflow, step } of failedSteps(pipeline)) {
        const log = LogSchema.parse(
          await input.request(
            repoPath(
              `/logs/${pipeline.number.toString()}/${step.id.toString()}`,
            ),
          ),
        );
        const tail = decodeLog(log).trim().slice(-1000);
        causes.push(
          `pipeline #${pipeline.number.toString()} ${workflow}/${step.name}: ${tail || "empty failed-step log"}`,
        );
      }
    }

    const combined = JSON.stringify({
      window: { from: since.toISOString(), to: observedAt },
      pipelines,
      inspectedFailureLogs: causes,
    });
    const noPipelinesFinding: Finding[] =
      pipelines.length === 0
        ? [
            {
              severity: "warning",
              summary: "No CI main pipelines were found in the last 24 hours",
              detail: `Queried pipelines created from ${since.toISOString()} through ${observedAt}`,
              evidenceReceiptIds: [EVIDENCE_ID],
            },
          ]
        : [];
    return {
      check: {
        id: CHECK_ID,
        label: CHECK_LABEL,
        required: true,
        status: "passed",
        summary: `${failed.length.toString()} failed of ${pipelines.length.toString()} main pipelines in 24h; latest ${latest === undefined ? "unavailable" : `#${latest.number.toString()} ${latest.status}`}; ${causes.length.toString()} failed step logs inspected`,
        evidenceReceiptIds: [EVIDENCE_ID],
      },
      evidence: {
        id: EVIDENCE_ID,
        source: SOURCE,
        observedAt,
        status: "success",
        ...(latest === undefined
          ? {}
          : { url: input.pipelineUrl(latest.number) }),
        excerpt: combined.slice(0, 2000),
        contentSha256: await sha256(combined),
      },
      findings: [
        ...actionable.map((pipeline) => ciPipelineFinding(pipeline, causes)),
        ...noPipelinesFinding,
      ],
      limitation: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: {
        id: CHECK_ID,
        label: CHECK_LABEL,
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: [EVIDENCE_ID],
      },
      evidence: {
        id: EVIDENCE_ID,
        source: SOURCE,
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
        contentSha256: await sha256(message),
      },
      findings: [],
      limitation: `CI main did not complete: ${message}`,
    };
  }
}

export async function collectCiMain(): Promise<CollectorResult> {
  const server = requiredEnv("WOODPECKER_URL");
  const repoId = requiredEnv("WOODPECKER_REPO_ID");
  return collectCiMainWith({
    now: new Date(),
    request: ciRequest,
    pipelineUrl: (number) =>
      `${server}/repos/${repoId}/pipeline/${number.toString()}`,
  });
}
