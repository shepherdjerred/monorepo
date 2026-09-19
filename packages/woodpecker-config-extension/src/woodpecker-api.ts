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
