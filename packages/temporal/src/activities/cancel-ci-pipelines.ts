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
});
const PipelineListSchema = z.array(PipelineSchema);

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

/**
 * Cancel in-flight CI for a branch whose pull request has closed.
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
  const params = new URLSearchParams();
  params.set("branch", input.branch);
  params.set("perPage", "100");
  const listUrl = `${base}?${params.toString()}`;

  let listResp: Response;
  try {
    listResp = await fetchFn(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Woodpecker list-pipelines request failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (listResp.status === 401 || listResp.status === 403) {
    throw new Error(
      "Woodpecker token is not authorized to list/cancel pipelines",
    );
  }
  if (!listResp.ok) {
    throw new Error(
      `Woodpecker list-pipelines failed with HTTP ${String(listResp.status)}`,
    );
  }

  const listed = PipelineListSchema.parse(await listResp.json());
  // Filter on branch again: the query parameter is a server-side convenience,
  // and cancelling another branch's build because the filter was ignored would
  // be far worse than listing too much.
  const active = listed.filter(
    (pipeline) =>
      pipeline.branch === input.branch && ACTIVE_STATUSES.has(pipeline.status),
  );

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
