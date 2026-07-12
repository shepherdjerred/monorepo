/**
 * Buildkite API: find the last successful base build.
 *
 * Walks main-branch build history to locate the most recent build that passed
 * its pipeline-bootstrap jobs, giving change detection a safe base commit to
 * diff against.
 */
import { z } from "zod";
import { errorMessage, type FetchFn } from "./shared.ts";

/**
 * Buildkite API shapes. Unknown fields are ignored. The API returns explicit
 * `null` for absent values (every keyless job has `step_key: null`; waiter and
 * trigger jobs null out `name`/`command`), so every field must be
 * null-tolerant — a null-rejecting schema here once dropped 100% of builds and
 * broke main CI's change detection.
 */
function nullToUndefined(value: unknown): unknown {
  return value ?? undefined;
}

const nullishString = z.preprocess(nullToUndefined, z.string().optional());
const nullishBoolean = z.preprocess(nullToUndefined, z.boolean().optional());

const BuildkiteJobSchema = z.object({
  type: nullishString,
  name: nullishString,
  command: nullishString,
  state: nullishString,
  step_key: nullishString,
  soft_failed: nullishBoolean,
});

const BuildkiteBuildSchema = z.object({
  number: z.preprocess(nullToUndefined, z.number().optional()),
  state: nullishString,
  blocked: nullishBoolean,
  commit: nullishString,
  jobs: z.preprocess(nullToUndefined, z.array(BuildkiteJobSchema).optional()),
});

type BuildkiteJob = z.infer<typeof BuildkiteJobSchema>;
type BuildkiteBuild = z.infer<typeof BuildkiteBuildSchema>;

type BuildRejectionReason =
  | "blocked"
  | "incomplete"
  | "missing-jobs"
  | "hard-failed-jobs";

const ACCEPTABLE_BUILD_STATES = new Set(["passed", "failed"]);
const EXEMPT_FAILED_STEP_KEYS = new Set(["argocd-health"]);
const EXEMPT_FAILED_JOB_STATES = new Set(["failed", "timed_out", "broken"]);
const PIPELINE_UPLOAD_COMMAND = "buildkite-agent pipeline upload";
const PIPELINE_GENERATE_COMMAND = ".buildkite/scripts/generate-pipeline.sh";

function isScriptJob(job: BuildkiteJob): boolean {
  return job.type === "script";
}

function isAllowedFailedJob(job: BuildkiteJob): boolean {
  if (job.soft_failed === true) return true;
  if (!EXEMPT_FAILED_JOB_STATES.has(job.state ?? "")) return false;
  return (
    job.step_key !== undefined && EXEMPT_FAILED_STEP_KEYS.has(job.step_key)
  );
}

function isCleanScriptJob(job: BuildkiteJob): boolean {
  return job.state === "passed" || isAllowedFailedJob(job);
}

function hasPipelineBootstrapJobs(scriptJobs: BuildkiteJob[]): boolean {
  return (
    scriptJobs.some(
      (job) =>
        job.command === PIPELINE_UPLOAD_COMMAND ||
        job.name === ":pipeline: Upload pipeline",
    ) &&
    scriptJobs.some(
      (job) =>
        job.command === PIPELINE_GENERATE_COMMAND ||
        job.name === ":pipeline: Generate Pipeline",
    )
  );
}

export function getBuildRejectionReason(
  build: BuildkiteBuild,
): BuildRejectionReason | null {
  if (build.blocked === true || build.state === "blocked") return "blocked";
  if (!ACCEPTABLE_BUILD_STATES.has(build.state ?? "")) return "incomplete";

  const scriptJobs = (build.jobs ?? []).filter((job) => isScriptJob(job));
  if (!hasPipelineBootstrapJobs(scriptJobs)) return "missing-jobs";

  return scriptJobs.every((job) => isCleanScriptJob(job))
    ? null
    : "hard-failed-jobs";
}

function parseBuildkiteBuilds(value: unknown): BuildkiteBuild[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Buildkite builds API returned non-array response: ${typeof value}`,
    );
  }

  const builds: BuildkiteBuild[] = [];
  let firstError: string | null = null;
  let failedCount = 0;
  for (const build of value) {
    const result = BuildkiteBuildSchema.safeParse(build);
    if (result.success) {
      builds.push(result.data);
    } else {
      failedCount++;
      firstError ??= result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
    }
  }

  // A build that fails to parse means the schema has drifted from the API, not
  // that the build is unusable — dropping it silently once made a 100%-parse
  // failure look like "no builds found". Surface drift loudly instead.
  if (failedCount > 0) {
    const summary = `${String(failedCount)}/${String(value.length)} Buildkite builds failed schema parsing (first error: ${firstError ?? "unknown"})`;
    if (builds.length === 0) {
      throw new Error(
        `${summary}; refusing to treat schema drift as empty history`,
      );
    }
    console.error(`WARNING: ${summary}`);
  }

  return builds;
}

/**
 * Maximum pages of Buildkite history to walk when searching for the last
 * successful main build. With `per_page=100` this is 1 000 builds — enough to
 * survive any realistic streak of cancellations + failures (we have seen 100+)
 * while still bounding the recovery cost. Beyond this we surface the
 * underlying CI rot rather than walking arbitrarily far back.
 */
const LAST_SUCCESS_MAX_PAGES = 10;
const LAST_SUCCESS_PAGE_SIZE = 100;

export async function getLastSuccessfulCommit(
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const override = Bun.env["LAST_SUCCESSFUL_COMMIT_OVERRIDE"];
  if (override !== undefined && override !== "") {
    console.error(
      `LAST_SUCCESSFUL_COMMIT_OVERRIDE set; using ${override.slice(0, 10)} as base (skipping Buildkite lookup)`,
    );
    return override;
  }

  const token = Bun.env["BUILDKITE_API_TOKEN"];
  if (!token) {
    throw new Error(
      "BUILDKITE_API_TOKEN is required for main-branch change detection",
    );
  }

  const org = Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "";
  const pipeline = Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "";
  const currentBuild = Bun.env["BUILDKITE_BUILD_NUMBER"] ?? "";

  if (!org || !pipeline) {
    throw new Error(
      "BUILDKITE_ORGANIZATION_SLUG and BUILDKITE_PIPELINE_SLUG are required for main-branch change detection",
    );
  }

  const skipped = new Map<BuildRejectionReason, number>();
  let buildsScanned = 0;
  let pagesWalked = 0;

  for (let page = 1; page <= LAST_SUCCESS_MAX_PAGES; page++) {
    const url =
      `https://api.buildkite.com/v2/organizations/${org}` +
      `/pipelines/${pipeline}/builds` +
      `?branch=main&per_page=${String(LAST_SUCCESS_PAGE_SIZE)}&page=${String(page)}`;

    let resp: Response;
    try {
      resp = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`Buildkite API request failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        "Buildkite API token is not authorized; expected REST API token with read_builds scope",
      );
    }

    if (!resp.ok) {
      throw new Error(`Buildkite API failed with HTTP ${String(resp.status)}`);
    }

    const builds = parseBuildkiteBuilds(await resp.json());
    buildsScanned += builds.length;
    pagesWalked = page;

    for (const build of builds) {
      if (String(build.number) === currentBuild) continue;

      const rejectionReason = getBuildRejectionReason(build);
      if (rejectionReason !== null) {
        skipped.set(rejectionReason, (skipped.get(rejectionReason) ?? 0) + 1);
        console.error(
          `Build #${String(build.number)} skipped: ${rejectionReason}`,
        );
        continue;
      }

      const commit = build.commit ?? "";
      if (!commit) {
        throw new Error(
          `Build #${String(build.number)} qualified as successful but did not include a commit SHA`,
        );
      }

      const scriptJobCount = (build.jobs ?? []).filter((job) =>
        isScriptJob(job),
      ).length;
      console.error(
        `Last successful base build: #${String(build.number)} (${String(scriptJobCount)} script jobs, commit ${commit.slice(0, 10)}, page ${String(page)})`,
      );
      return commit;
    }

    if (builds.length < LAST_SUCCESS_PAGE_SIZE) {
      // Reached end of history — no point requesting further pages.
      break;
    }
  }

  const reasonSummary = [...skipped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}: ${String(count)}`)
    .join(", ");
  throw new Error(
    `No qualifying successful main build found in last ${String(buildsScanned)} builds (${String(pagesWalked)} pages); ` +
      `cannot scope this build safely${reasonSummary ? ` (${reasonSummary})` : ""}. ` +
      `Set LAST_SUCCESSFUL_COMMIT_OVERRIDE on a rebuild to manually unstick main CI.`,
  );
}

// Aliases for the test surface (same-file re-declaration exports).
export {
  getBuildRejectionReason as _getBuildRejectionReason,
  getLastSuccessfulCommit as _getLastSuccessfulCommit,
};
