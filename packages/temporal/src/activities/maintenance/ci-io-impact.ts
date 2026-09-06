import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import {
  collectCiIoObservability,
  type CiIoObservabilityResult,
} from "./ci-io-observability.ts";

const PullRequestSchema = z.object({
  merged_at: z.iso.datetime({ offset: true }).nullable(),
  merge_commit_sha: z.string().min(1).nullable(),
  html_url: z.url(),
});
const BuildSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  web_url: z.url(),
  env: z.record(z.string(), z.string()).optional(),
});
const BuildsSchema = z.array(BuildSchema);
const CiIoReportSchema = z.object({
  schemaVersion: z.literal(4),
  generatedAt: z.iso.datetime({ offset: true }),
  metricSource: z.enum(["raw", "recording"]),
  candidate: z.object({
    buildNumbers: z.array(z.number().int().positive()),
    integrityIssues: z.array(
      z.object({ code: z.string(), message: z.string() }),
    ),
    summary: z.object({
      buildCount: z.number().int().nonnegative(),
      measuredJobCount: z.number().int().nonnegative(),
      missingJobCount: z.number().int().nonnegative(),
      sampleCoveragePercent: z.number().nullable(),
      totalWriteBytes: z.number().nonnegative(),
      totalNetworkReceiveBytes: z.number().nonnegative(),
      totalNetworkTransmitBytes: z.number().nonnegative(),
      p95DurationSeconds: z.number().nullable(),
    }),
  }),
  comparison: z
    .object({
      fixedCorpusGate: z.object({
        status: z.enum(["passed", "failed", "inconclusive"]),
        aggregateWriteReductionPercent: z.number().nullable(),
        p95DurationChangePercent: z.number().nullable(),
        reasons: z.array(z.string()),
      }),
    })
    .nullable(),
});
type CiIoReport = z.infer<typeof CiIoReportSchema>;

export type CiIoImpactResult = {
  observedAt: string;
  mergedAt: string;
  mergeSha: string;
  prUrl: string;
  elapsedHours: number;
  postMergeBuildCount: number;
  candidateBuilds: number[];
  pendingReason: string | undefined;
  raw: CiIoReport | undefined;
  rawExitCode: number | undefined;
  rawError: string | undefined;
  recording: CiIoReport | undefined;
  recordingExitCode: number | undefined;
  recordingError: string | undefined;
  observability: CiIoObservabilityResult[];
  evidenceJson: string;
};

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const MERGE_PR = 1602;
const BASELINE_FROM = "2026-07-19T11:36:05.932Z";
const BASELINE_TO = "2026-07-20T03:12:23.994Z";

type CandidateBuild = {
  number: number;
  state: string;
  env?: Record<string, string> | undefined;
};

const CI_IO_FINISHED_BUILD_STATES = new Set(["passed", "failed"]);

export function countCiIoFinishedBuilds(
  builds: readonly Pick<CandidateBuild, "state">[],
): number {
  return builds.filter((build) => CI_IO_FINISHED_BUILD_STATES.has(build.state))
    .length;
}

export function selectCiIoCandidateBuilds(
  builds: readonly CandidateBuild[],
): number[] {
  return builds
    .filter(
      (build) =>
        build.env?.["CI_IO_FIXED_CORPUS"] === "true" &&
        CI_IO_FINISHED_BUILD_STATES.has(build.state),
    )
    .toSorted((left, right) => right.number - left.number)
    .slice(0, 1)
    .map((build) => build.number);
}

async function apiJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`${url} returned HTTP ${response.status.toString()}`);
  return response.json();
}

async function buildkiteBuilds(
  mergedAt: string,
): Promise<z.infer<typeof BuildsSchema>> {
  const token = Bun.env["BUILDKITE_API_TOKEN"];
  if (token === undefined || token === "")
    throw new Error("BUILDKITE_API_TOKEN is required");
  const builds: z.infer<typeof BuildsSchema> = [];
  let page = 1;
  let batch: z.infer<typeof BuildsSchema>;
  do {
    const url = new URL(
      "/v2/organizations/sjerred/pipelines/monorepo/builds",
      "https://api.buildkite.com",
    );
    url.searchParams.set("branch", "main");
    url.searchParams.set("created_from", mergedAt);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", page.toString());
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Buildkite returned HTTP ${response.status.toString()}`);
    }
    batch = BuildsSchema.parse(await response.json());
    builds.push(...batch);
    page += 1;
  } while (batch.length === 100);
  return builds;
}

async function runReporter(
  repoDir: string,
  args: string[],
  stem: string,
): Promise<{
  report: CiIoReport | undefined;
  exitCode: number;
  error: string | undefined;
}> {
  const jsonPath = `${repoDir}/../${stem}.json`;
  const markdownPath = `${repoDir}/../${stem}.md`;
  const process = Bun.spawn(
    [
      "bun",
      "scripts/ci-io-report.ts",
      ...args,
      "--json",
      jsonPath,
      "--markdown",
      markdownPath,
    ],
    {
      cwd: repoDir,
      env: {
        ...Bun.env,
        BUILDKITE_ORGANIZATION_SLUG: "sjerred",
        BUILDKITE_PIPELINE_SLUG: "monorepo",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const report = (await Bun.file(jsonPath).exists())
    ? CiIoReportSchema.parse(JSON.parse(await Bun.file(jsonPath).text()))
    : undefined;
  return {
    report,
    exitCode,
    error:
      exitCode === 0
        ? undefined
        : `${stdout}\n${stderr}`.trim().slice(-2000) || "reporter failed",
  };
}

export async function collectCiIoImpact(): Promise<CiIoImpactResult> {
  const observedAt = new Date().toISOString();
  const { token } = await createGitHubAppInstallationToken();
  const pull = PullRequestSchema.parse(
    await apiJson(
      `https://api.github.com/repos/shepherdjerred/monorepo/pulls/${MERGE_PR.toString()}`,
      token,
    ),
  );
  if (pull.merged_at === null || pull.merge_commit_sha === null) {
    throw new Error(`CI I/O PR #${MERGE_PR.toString()} is not merged`);
  }
  const elapsedHours =
    (Date.now() - Date.parse(pull.merged_at)) / (60 * 60 * 1000);
  const builds = await buildkiteBuilds(pull.merged_at);
  const postMergeBuildCount = countCiIoFinishedBuilds(builds);
  const candidateBuilds = selectCiIoCandidateBuilds(builds);
  const pendingReason =
    elapsedHours < 24
      ? "The 24-hour observation window is not complete."
      : candidateBuilds.length === 0
        ? "No completed main build with CI_IO_FIXED_CORPUS=true is available."
        : undefined;
  if (pendingReason !== undefined) {
    const evidence = { pull, elapsedHours, candidateBuilds, pendingReason };
    return {
      observedAt,
      mergedAt: pull.merged_at,
      mergeSha: pull.merge_commit_sha,
      prUrl: pull.html_url,
      elapsedHours,
      postMergeBuildCount,
      candidateBuilds,
      pendingReason,
      raw: undefined,
      rawExitCode: undefined,
      rawError: undefined,
      recording: undefined,
      recordingExitCode: undefined,
      recordingError: undefined,
      observability: [],
      evidenceJson: JSON.stringify(evidence),
    };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "ci-io-impact-"));
  const repoDir = `${tempDir}/monorepo`;
  try {
    await simpleGit().clone(REPO_URL, repoDir, [
      "--branch",
      "main",
      "--single-branch",
      "--filter=blob:none",
    ]);
    await runCommand(
      [
        "bun",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--filter",
        "@shepherdjerred/root-scripts",
      ],
      { cwd: repoDir },
    );
    const buildArg = candidateBuilds.join(",");
    const recordingBuild = candidateBuilds[0];
    if (recordingBuild === undefined) {
      throw new Error(
        "fixed-corpus candidate selection unexpectedly became empty",
      );
    }
    const raw = await runReporter(
      repoDir,
      [
        "--build",
        buildArg,
        "--baseline-from",
        BASELINE_FROM,
        "--baseline-to",
        BASELINE_TO,
        "--metrics-source",
        "raw",
        "--enforce-impact-gates",
      ],
      `ci-io-impact-raw-${crypto.randomUUID()}`,
    );
    const recording = await runReporter(
      repoDir,
      [
        "--build",
        recordingBuild.toString(),
        "--metrics-source",
        "recording",
        "--benchmark",
      ],
      `ci-io-impact-recording-${crypto.randomUUID()}`,
    );
    const observability = await collectCiIoObservability();
    const evidence = { pull, candidateBuilds, raw, recording, observability };
    return {
      observedAt,
      mergedAt: pull.merged_at,
      mergeSha: pull.merge_commit_sha,
      prUrl: pull.html_url,
      elapsedHours,
      postMergeBuildCount,
      candidateBuilds,
      pendingReason: undefined,
      raw: raw.report,
      rawExitCode: raw.exitCode,
      rawError: raw.error,
      recording: recording.report,
      recordingExitCode: recording.exitCode,
      recordingError: recording.error,
      observability,
      evidenceJson: JSON.stringify(evidence).slice(0, 100_000),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export const ciIoImpactActivities = { collectCiIoImpact };
export type CiIoImpactActivities = typeof ciIoImpactActivities;
