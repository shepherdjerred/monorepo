import { z } from "zod";
import { isPrVerificationEvent } from "#src/pr-event.ts";
import type { Pipeline } from "#src/schemas.ts";
import type { WoodpeckerApiOptions } from "#src/woodpecker-api.ts";

const ActivePipelineSchema = z.looseObject({
  number: z.number().int().positive(),
  ref: z.string(),
  event: z.string(),
  event_reason: z.array(z.string()).nullable().optional(),
  pr_draft: z.boolean().optional(),
  status: z.string(),
});

function prNumber(ref: string): string | undefined {
  return /^refs\/pull\/([1-9]\d*)\/(?:head|merge)$/u.exec(ref)?.[1];
}

type ActivePipeline = z.infer<typeof ActivePipelineSchema>;
type CurrentPipeline = Pick<
  Pipeline,
  "number" | "ref" | "event" | "event_reason" | "pr_draft"
>;

function client(options: WoodpeckerApiOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(3000);
  const request = async (path: string, method = "GET") => {
    const response = await fetchImpl(new URL(path, options.baseUrl), {
      method,
      headers: { authorization: `Bearer ${options.token}` },
      signal,
    });
    if (!response.ok)
      throw new Error(
        `PR supersession API returned ${response.status.toString()}`,
      );
    return response;
  };
  return {
    request,
    json: async (path: string): Promise<unknown> => {
      const response = await request(path);
      return response.json();
    },
  };
}

function superseded(
  pipeline: ActivePipeline,
  current: CurrentPipeline,
  pr: string,
): boolean {
  return (
    pipeline.number < current.number &&
    prNumber(pipeline.ref) === pr &&
    ["pending", "running"].includes(pipeline.status) &&
    isPrVerificationEvent(pipeline) &&
    !(current.event === "pull_request" && pipeline.event === "pull_request")
  );
}

async function candidatesForPr(
  api: ReturnType<typeof client>,
  prefix: string,
  current: CurrentPipeline,
  pr: string,
): Promise<ActivePipeline[]> {
  const candidates = new Map<number, ActivePipeline>();
  const event =
    current.event === "pull_request"
      ? "pull_request_metadata"
      : "pull_request,pull_request_metadata";
  // Collect before mutating: cancellation changes the filtered pagination.
  for (const status of ["running", "pending"]) {
    for (let page = 1; page <= 5; page++) {
      const query = new URLSearchParams({
        event,
        ref: `refs/pull/${pr}/`,
        status,
        perPage: "50",
        page: page.toString(),
      });
      const listed = z
        .array(ActivePipelineSchema)
        .parse(await api.json(`${prefix}?${query.toString()}`));
      for (const pipeline of listed.filter((entry) =>
        superseded(entry, current, pr),
      )) {
        candidates.set(pipeline.number, pipeline);
      }
      if (listed.length < 50) break;
      if (page === 5)
        throw new Error(
          "PR supersession exceeded its bounded active-pipeline scan",
        );
    }
  }
  return [...candidates.values()];
}

async function cancelCandidate(
  api: ReturnType<typeof client>,
  prefix: string,
  candidate: ActivePipeline,
): Promise<boolean> {
  const path = `${prefix}/${candidate.number.toString()}`;
  const fresh = ActivePipelineSchema.parse(await api.json(path));
  if (
    fresh.number !== candidate.number ||
    fresh.ref !== candidate.ref ||
    fresh.event !== candidate.event
  )
    throw new Error("PR supersession identity changed during revalidation");
  if (
    !["pending", "running"].includes(fresh.status) ||
    !isPrVerificationEvent(fresh)
  )
    return false;
  try {
    await api.request(`${path}/cancel`, "POST");
    return true;
  } catch (error) {
    const after = ActivePipelineSchema.parse(await api.json(path));
    if (
      after.number !== fresh.number ||
      after.ref !== fresh.ref ||
      ["pending", "running"].includes(after.status)
    )
      throw error;
  }
  return false;
}

/** Native supersession only compares equal event types. Bridge ready events. */
export async function cancelSupersededPr(
  repoId: number,
  current: CurrentPipeline,
  options: WoodpeckerApiOptions,
): Promise<number[]> {
  const pr = prNumber(current.ref);
  if (pr === undefined || current.number < 1 || !isPrVerificationEvent(current))
    return [];
  const api = client(options);
  const prefix = `/api/repos/${repoId.toString()}/pipelines`;
  const candidates = await candidatesForPr(api, prefix, current, pr);
  const cancelled: number[] = [];
  for (const candidate of candidates) {
    if (await cancelCandidate(api, prefix, candidate))
      cancelled.push(candidate.number);
  }
  return cancelled;
}
