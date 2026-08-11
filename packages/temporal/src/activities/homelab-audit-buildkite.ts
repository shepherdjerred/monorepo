import { z } from "zod/v4";
import type {
  ReportCheckV1,
  ReportEvidenceReceiptV1,
  ReportEnvelopeV1,
} from "#shared/report.ts";

const BuildkiteBuildSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  web_url: z.url(),
  commit: z.string(),
  jobs: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable().optional(),
      state: z.string(),
      web_url: z.url().nullable().optional(),
    }),
  ),
});
const BuildkiteBuildsSchema = z.array(BuildkiteBuildSchema);
const BuildkiteLogSchema = z.object({ content: z.string() });

type Build = z.infer<typeof BuildkiteBuildSchema>;
type Finding = ReportEnvelopeV1["findings"][number];
type CollectorResult = {
  check: ReportCheckV1;
  evidence: ReportEvidenceReceiptV1;
  findings: Finding[];
  limitation: string | undefined;
};
type BuildkiteRequest = (path: string) => Promise<unknown>;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildkiteRequest(path: string): Promise<unknown> {
  const token = Bun.env["BUILDKITE_API_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error("BUILDKITE_API_TOKEN is required");
  }
  const response = await fetch(`https://api.buildkite.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Buildkite returned HTTP ${String(response.status)}`);
  }
  return response.json();
}

function buildsPath(since: Date, page: number): string {
  const parameters = new URLSearchParams({
    branch: "main",
    created_from: since.toISOString(),
    per_page: "100",
    page: page.toString(),
  });
  return `/v2/organizations/sjerred/pipelines/monorepo/builds?${parameters.toString()}`;
}

async function allBuildsSince(
  since: Date,
  request: BuildkiteRequest,
): Promise<Build[]> {
  const builds: Build[] = [];
  let page = 1;
  let current: Build[];
  do {
    current = BuildkiteBuildsSchema.parse(
      await request(buildsPath(since, page)),
    );
    builds.push(...current);
    page += 1;
  } while (current.length === 100);
  return builds;
}

export function buildkiteFailureFinding(
  build: Build,
  causes: readonly string[],
): Finding {
  const detail = causes
    .filter((cause) => cause.startsWith(`build #${build.number.toString()} `))
    .join("\n")
    .slice(0, 2000);
  return {
    severity: "warning",
    summary: `Buildkite main build #${build.number.toString()} failed`,
    ...(detail === "" ? {} : { detail }),
    evidenceReceiptIds: ["buildkite-main-evidence"],
  };
}

export async function collectBuildkiteWith(input: {
  now: Date;
  request: BuildkiteRequest;
}): Promise<CollectorResult> {
  const observedAt = input.now.toISOString();
  const evidenceId = "buildkite-main-evidence";
  const since = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
  try {
    const builds = await allBuildsSince(since, input.request);
    const failedBuilds = builds.filter((build) => build.state === "failed");
    const causes: string[] = [];
    for (const build of failedBuilds) {
      for (const job of build.jobs.filter(
        (candidate) => candidate.state === "failed",
      )) {
        const log = BuildkiteLogSchema.parse(
          await input.request(
            `/v2/organizations/sjerred/pipelines/monorepo/builds/${build.number.toString()}/jobs/${job.id}/log`,
          ),
        );
        const tail = log.content.trim().slice(-1000);
        causes.push(
          `build #${build.number.toString()} ${job.name ?? job.id}: ${tail || "empty failed-job log"}`,
        );
      }
    }
    const combined = JSON.stringify({
      window: { from: since.toISOString(), to: observedAt },
      builds,
      inspectedFailureLogs: causes,
    });
    const noBuildsFinding: Finding[] =
      builds.length === 0
        ? [
            {
              severity: "warning",
              summary:
                "No Buildkite main builds were found in the last 24 hours",
              detail: `Queried builds created from ${since.toISOString()} through ${observedAt}`,
              evidenceReceiptIds: [evidenceId],
            },
          ]
        : [];
    return {
      check: {
        id: "buildkite-main",
        label: "Buildkite main builds",
        required: true,
        status: "passed",
        summary: `${failedBuilds.length.toString()} failed of ${builds.length.toString()} main builds in 24h; ${causes.length.toString()} failed job logs inspected`,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: "Buildkite REST API",
        observedAt,
        status: "success",
        ...(builds[0] === undefined ? {} : { url: builds[0].web_url }),
        excerpt: combined.slice(0, 2000),
        contentSha256: await sha256(combined),
      },
      findings: [
        ...failedBuilds.map((build) => buildkiteFailureFinding(build, causes)),
        ...noBuildsFinding,
      ],
      limitation: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: {
        id: "buildkite-main",
        label: "Buildkite main builds",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: "Buildkite REST API",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
        contentSha256: await sha256(message),
      },
      findings: [],
      limitation: `Buildkite main did not complete: ${message}`,
    };
  }
}

export async function collectBuildkite(): Promise<CollectorResult> {
  return collectBuildkiteWith({ now: new Date(), request: buildkiteRequest });
}
