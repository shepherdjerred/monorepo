import { z } from "zod/v4";
import type { CancelBuildkiteBuildsInput } from "#shared/schemas.ts";

const COMPONENT = "cancel-bk-builds";

/**
 * Injectable fetch so the implementation can be unit-tested without a real
 * Buildkite API. The exported activity passes the global `fetch`.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BuildkiteBuildSchema = z.object({
  number: z.number(),
  state: z.string(),
  branch: z.string(),
});
const BuildkiteBuildsSchema = z.array(BuildkiteBuildSchema);

/**
 * Non-terminal Buildkite build states — only these can be cancelled. Terminal
 * states (passed / failed / canceled / skipped / not_run) are excluded from
 * the list query so we never attempt to re-cancel a finished build.
 */
const ACTIVE_STATES = [
  "creating",
  "scheduled",
  "running",
  "blocked",
  "canceling",
] as const;

export type CancelBuildkiteBuildsResult = {
  cancelled: number[];
  skipped: number;
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

/**
 * Pure implementation behind the `cancelBuildkiteBuildsForBranch` activity.
 * Lists active builds for `input.branch` and issues a cancel PUT per build.
 * A 4xx on the cancel call (build finished between list and cancel) is a
 * benign skip; a 5xx throws so Temporal retries.
 */
export async function cancelBuildkiteBuildsForBranchImpl(
  input: CancelBuildkiteBuildsInput,
  fetchFn: FetchFn,
): Promise<CancelBuildkiteBuildsResult> {
  const token = Bun.env["BUILDKITE_API_TOKEN"] ?? "";
  if (token === "") {
    throw new Error(
      "BUILDKITE_API_TOKEN is required to cancel Buildkite builds",
    );
  }

  const org = Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "";
  const pipeline = Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "";
  if (org === "" || pipeline === "") {
    throw new Error(
      "BUILDKITE_ORGANIZATION_SLUG and BUILDKITE_PIPELINE_SLUG are required to cancel Buildkite builds",
    );
  }

  const params = new URLSearchParams();
  params.set("branch", input.branch);
  params.set("per_page", "100");
  for (const state of ACTIVE_STATES) {
    params.append("state[]", state);
  }

  const base = `https://api.buildkite.com/v2/organizations/${org}/pipelines/${pipeline}/builds`;
  const listUrl = `${base}?${params.toString()}`;

  let listResp: Response;
  try {
    listResp = await fetchFn(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Buildkite list-builds request failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (listResp.status === 401 || listResp.status === 403) {
    throw new Error(
      "Buildkite API token is not authorized to list/cancel builds; expected REST API token with write_builds scope",
    );
  }
  if (!listResp.ok) {
    throw new Error(
      `Buildkite list-builds failed with HTTP ${String(listResp.status)}`,
    );
  }

  const builds = BuildkiteBuildsSchema.parse(await listResp.json());

  const cancelled: number[] = [];
  let skipped = 0;

  for (const build of builds) {
    const cancelUrl = `${base}/${String(build.number)}/cancel`;
    let resp: Response;
    try {
      resp = await fetchFn(cancelUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        `Buildkite cancel request for #${String(build.number)} failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        "Buildkite API token is not authorized to cancel builds; expected REST API token with write_builds scope",
      );
    }

    if (resp.ok) {
      cancelled.push(build.number);
      continue;
    }

    // The build reached a terminal state between our list and cancel calls —
    // Buildkite returns a 4xx ("cannot cancel a finished build"). Treat as a
    // benign skip rather than failing the whole workflow.
    if (resp.status >= 400 && resp.status < 500) {
      skipped++;
      jsonLog("info", "skip cancel; build no longer cancelable", {
        build: build.number,
        state: build.state,
        status: resp.status,
      });
      continue;
    }

    throw new Error(
      `Buildkite cancel for #${String(build.number)} failed with HTTP ${String(resp.status)}`,
    );
  }

  jsonLog("info", "cancel-bk-builds complete", {
    branch: input.branch,
    prNumber: input.prNumber,
    merged: input.merged,
    cancelled,
    skipped,
  });

  return { cancelled, skipped };
}

export type CancelBuildkiteBuildsActivities =
  typeof cancelBuildkiteBuildsActivities;

export const cancelBuildkiteBuildsActivities = {
  async cancelBuildkiteBuildsForBranch(
    input: CancelBuildkiteBuildsInput,
  ): Promise<CancelBuildkiteBuildsResult> {
    return cancelBuildkiteBuildsForBranchImpl(input, fetch);
  },
};
