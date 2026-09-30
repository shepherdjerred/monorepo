import { z } from "zod/v4";
import type { CancelCiPipelinesInput } from "#shared/schemas.ts";

const COMPONENT = "cancel-ci-pipelines";

/**
 * Injectable fetch so the implementation can be unit-tested without a real
 * Woodpecker API. The exported activity passes the global `fetch`.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const PipelineSchema = z.object({
  number: z.number(),
  status: z.string(),
  branch: z.string(),
  event: z.string().nullish(),
  ref: z.string().nullish(),
  commit: z.string().nullish(),
});
const PipelineListSchema = z.array(PipelineSchema);
type Pipeline = z.infer<typeof PipelineSchema>;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

/**
 * Non-terminal Woodpecker statuses — only these can be cancelled.
 *
 * Woodpecker's list endpoint takes a single `status`, not a set, so the filter
 * is applied client-side after listing. Terminal statuses (success, failure,
 * error, killed, declined, skipped) are excluded here so a finished pipeline
 * is never re-cancelled.
 */
const ACTIVE_STATUSES = new Set(["pending", "running", "blocked"]);

export type CancelCiPipelinesResult = {
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

function matchesClosedPr(
  pipeline: Pipeline,
  input: CancelCiPipelinesInput,
): boolean {
  if (!ACTIVE_STATUSES.has(pipeline.status)) return false;
  // Woodpecker reports PR builds under the target branch (often main),
  // so match the PR ref and exact head. Push builds use the source branch.
  const prEvent =
    pipeline.event === "pull_request" ||
    pipeline.event === "pull_request_metadata";
  return (
    (prEvent &&
      pipeline.ref === `refs/pull/${String(input.prNumber)}/merge` &&
      pipeline.commit === input.commitSha) ||
    (pipeline.event === "push" &&
      pipeline.branch === input.branch &&
      pipeline.commit === input.commitSha)
  );
}

async function listPipelinePage(opts: {
  base: string;
  token: string;
  page: number;
  filter: { key: "ref" | "branch"; value: string };
  fetchFn: FetchFn;
}): Promise<Pipeline[]> {
  const params = new URLSearchParams({
    [opts.filter.key]: opts.filter.value,
    page: String(opts.page),
    perPage: String(PAGE_SIZE),
  });
  let response: Response;
  try {
    response = await opts.fetchFn(`${opts.base}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Woodpecker list-pipelines request failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Woodpecker token is not authorized to list/cancel pipelines",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Woodpecker list-pipelines failed with HTTP ${String(response.status)}`,
    );
  }
  return PipelineListSchema.parse(await response.json());
}

async function listFilteredClosedPrPipelines(opts: {
  base: string;
  token: string;
  input: CancelCiPipelinesInput;
  filter: { key: "ref" | "branch"; value: string };
  fetchFn: FetchFn;
}): Promise<Pipeline[]> {
  const active: Pipeline[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const listed = await listPipelinePage({ ...opts, page });
    for (const pipeline of listed) {
      if (seen.has(pipeline.number)) {
        throw new Error("Woodpecker pipeline pagination did not advance");
      }
      seen.add(pipeline.number);
      if (matchesClosedPr(pipeline, opts.input)) active.push(pipeline);
    }
    if (listed.length < PAGE_SIZE) return active;
  }
  throw new Error("Woodpecker pipeline list exceeded pagination limit");
}

async function listActiveClosedPrPipelines(
  base: string,
  token: string,
  input: CancelCiPipelinesInput,
  fetchFn: FetchFn,
): Promise<Pipeline[]> {
  const prRef = `refs/pull/${String(input.prNumber)}/merge`;
  const prBuilds = await listFilteredClosedPrPipelines({
    base,
    token,
    input,
    filter: { key: "ref", value: prRef },
    fetchFn,
  });
  const pushBuilds = await listFilteredClosedPrPipelines({
    base,
    token,
    input,
    filter: { key: "branch", value: input.branch },
    fetchFn,
  });
  const unique = new Map<number, Pipeline>();
  for (const pipeline of [...prBuilds, ...pushBuilds]) {
    unique.set(pipeline.number, pipeline);
  }
  return [...unique.values()];
}

/**
 * Cancel in-flight CI for a pull request that has closed.
 *
 * A 4xx on the cancel call means the pipeline reached a terminal status
 * between the list and the cancel, which is a benign skip; a 5xx throws so
 * Temporal retries.
 */
export async function cancelCiPipelinesForBranchImpl(
  input: CancelCiPipelinesInput,
  fetchFn: FetchFn,
): Promise<CancelCiPipelinesResult> {
  const token = Bun.env["WOODPECKER_TOKEN"] ?? "";
  if (token === "") {
    throw new Error("WOODPECKER_TOKEN is required to cancel CI pipelines");
  }

  // WOODPECKER_URL, not WOODPECKER_SERVER: upstream uses the latter for the
  // agent's gRPC endpoint, and reusing it for an HTTP origin is how a host
  // that works for one ends up silently wrong for the other.
  const server = Bun.env["WOODPECKER_URL"] ?? "";
  const repoId = Bun.env["WOODPECKER_REPO_ID"] ?? "";
  if (server === "" || repoId === "") {
    throw new Error(
      "WOODPECKER_URL and WOODPECKER_REPO_ID are required to cancel CI pipelines",
    );
  }

  const base = `${server}/api/repos/${repoId}/pipelines`;
  const active = await listActiveClosedPrPipelines(base, token, input, fetchFn);

  const cancelled: number[] = [];
  let skipped = 0;

  for (const pipeline of active) {
    const cancelUrl = `${base}/${String(pipeline.number)}/cancel`;
    let resp: Response;
    try {
      resp = await fetchFn(cancelUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        `Woodpecker cancel request for #${String(pipeline.number)} failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Woodpecker token is not authorized to cancel pipelines");
    }

    if (resp.ok) {
      cancelled.push(pipeline.number);
      continue;
    }

    // The pipeline finished between the list and the cancel. Treat as a
    // benign skip rather than failing the whole workflow.
    if (resp.status >= 400 && resp.status < 500) {
      skipped++;
      jsonLog("info", "skip cancel; pipeline no longer cancelable", {
        pipeline: pipeline.number,
        status: pipeline.status,
        httpStatus: resp.status,
      });
      continue;
    }

    throw new Error(
      `Woodpecker cancel for #${String(pipeline.number)} failed with HTTP ${String(resp.status)}`,
    );
  }

  jsonLog("info", "cancel-ci-pipelines complete", {
    branch: input.branch,
    prNumber: input.prNumber,
    merged: input.merged,
    cancelled,
    skipped,
  });

  return { cancelled, skipped };
}

export type CancelCiPipelinesActivities = typeof cancelCiPipelinesActivities;

export const cancelCiPipelinesActivities = {
  async cancelCiPipelinesForBranch(
    input: CancelCiPipelinesInput,
  ): Promise<CancelCiPipelinesResult> {
    return cancelCiPipelinesForBranchImpl(input, fetch);
  },
};
