import type { FetchLike } from "#src/http.ts";
import { z } from "zod";

/**
 * Minimal Woodpecker API client, used for one question: what is the newest
 * commit on the default branch whose pipeline succeeded?
 *
 * That commit is the base for change detection and for `TURBO_SCM_BASE`. The
 * Buildkite pipeline answered it by calling the Buildkite REST API from a
 * bootstrap step and handing the result to every other step through build
 * metadata. Resolving it here instead removes both the API dependency and the
 * handoff: the value is known before any step is generated, so it can be
 * written straight into each step's environment.
 */

const PipelineSummarySchema = z.looseObject({
  commit: z.string(),
  status: z.string(),
});

const PipelineListSchema = z.array(PipelineSummarySchema);

/**
 * A pipeline's detail view, which carries its individual workflows.
 *
 * Each generated step is its own workflow, so per-step outcomes are read from
 * here rather than from the pipeline's overall status.
 */
/**
 * Just enough of the list to address each pipeline's detail view.
 *
 * Deliberately narrower than PipelineSummarySchema: this path decides from
 * per-workflow outcomes, so requiring an overall `status` it never reads would
 * reject a perfectly valid response.
 */
const PipelineReferenceListSchema = z.array(
  z.looseObject({ number: z.number() }),
);

const PipelineDetailSchema = z.looseObject({
  commit: z.string(),
  status: z.string(),
  workflows: z
    .array(z.looseObject({ name: z.string(), state: z.string() }))
    .default([]),
});

export type WoodpeckerApiOptions = {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: FetchLike;
};

/**
 * Newest successful commit on `branch`, or undefined when there is none.
 *
 * Undefined is a legitimate answer — a brand new repository, or a branch whose
 * history has never gone green — and callers must treat it as "compare against
 * nothing", which selects every lane. Returning a wrong-but-plausible base
 * would silently narrow CI instead.
 */
async function getJson(
  url: URL,
  options: WoodpeckerApiOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!response.ok) {
    throw new Error(
      `could not list Woodpecker pipelines (${response.status.toString()})`,
    );
  }
  return response.json();
}

function pipelinesUrl(repoId: number, options: WoodpeckerApiOptions): URL {
  return new URL(`/api/repos/${repoId.toString()}/pipelines`, options.baseUrl);
}

/**
 * Newest commit on `branch` where every named workflow succeeded.
 *
 * Stricter than `lastSuccessfulCommit`, and deliberately so: the image lane's
 * base must be a commit whose images were built, pushed, AND pinned, not
 * merely one whose pipeline went green. A pipeline can pass overall with those
 * workflows skipped, and treating such a commit as the base would make the
 * next build believe images already exist for content that was never built.
 *
 * Returns undefined when no recent pipeline qualifies, which callers must read
 * as "no base" -- building everything -- rather than as an error.
 */
export async function lastCommitWithSuccessfulWorkflows(
  repoId: number,
  branch: string,
  workflowNames: readonly string[],
  options: WoodpeckerApiOptions & { readonly scanLimit?: number },
): Promise<string | undefined> {
  const scanLimit = options.scanLimit ?? 20;
  const listUrl = pipelinesUrl(repoId, options);
  listUrl.searchParams.set("branch", branch);
  listUrl.searchParams.set("event", "push");
  listUrl.searchParams.set("perPage", scanLimit.toString());

  const listed = PipelineReferenceListSchema.safeParse(
    await getJson(listUrl, options),
  );
  if (!listed.success) {
    throw new Error("unexpected Woodpecker pipeline list shape");
  }

  for (const summary of listed.data) {
    const detailUrl = new URL(
      `/api/repos/${repoId.toString()}/pipelines/${summary.number.toString()}`,
      options.baseUrl,
    );
    const detail = PipelineDetailSchema.safeParse(
      await getJson(detailUrl, options),
    );
    if (!detail.success) continue;
    const succeeded = new Set(
      detail.data.workflows
        .filter((workflow) => workflow.state === "success")
        .map((workflow) => workflow.name),
    );
    if (workflowNames.every((name) => succeeded.has(name))) {
      return detail.data.commit;
    }
  }
  return undefined;
}

export async function lastSuccessfulCommit(
  repoId: number,
  branch: string,
  options: WoodpeckerApiOptions,
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(
    `/api/repos/${repoId.toString()}/pipelines`,
    options.baseUrl,
  );
  url.searchParams.set("branch", branch);
  url.searchParams.set("status", "success");
  url.searchParams.set("event", "push");
  url.searchParams.set("perPage", "1");

  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!response.ok) {
    throw new Error(
      `could not list Woodpecker pipelines (${response.status.toString()})`,
    );
  }

  const parsed = PipelineListSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("unexpected Woodpecker pipeline list shape");
  }

  // Filter on status again rather than trusting the query parameter: a server
  // that ignored it would otherwise hand back a failed build's commit as the
  // last known-good base.
  return parsed.data.find((pipeline) => pipeline.status === "success")?.commit;
}
