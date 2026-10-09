import { z } from "zod";
import { resolveCredentials } from "#lib/credentials.ts";

export const WOODPECKER_URL = "https://woodpecker.sjer.red";

const StepSchema = z.object({
  id: z.number().int().positive(),
  pid: z.number().int(),
  name: z.string(),
  state: z.string(),
  error: z.string().optional(),
  exit_code: z.number().int(),
  started: z.number().optional(),
  finished: z.number().optional(),
  type: z.string().optional(),
});
const WorkflowSchema = z.object({
  name: z.string(),
  state: z.string(),
  id: z.number().optional(),
  pid: z.number().optional(),
  error: z.string().optional(),
  started: z.number().optional(),
  finished: z.number().optional(),
  children: z.array(StepSchema).optional(),
});
const SummarySchema = z.object({
  number: z.number().int().positive(),
  commit: z.string(),
  status: z.string(),
  event: z.string().optional(),
  event_reason: z.array(z.string()).nullish(),
  pr_draft: z.boolean().optional(),
  ref: z.string().optional(),
  branch: z.string().optional(),
  rerun_count: z.number().int().optional(),
  created: z.number().optional(),
  started: z.number().optional(),
  finished: z.number().optional(),
});
export const WoodpeckerPipelineSchema = SummarySchema.extend({
  workflows: z.array(WorkflowSchema).default([]),
  errors: z.array(z.unknown()).nullish(),
});
export type WoodpeckerPipeline = z.infer<typeof WoodpeckerPipelineSchema>;
export type WoodpeckerConfig = {
  readonly baseUrl: string;
  readonly token: string;
  readonly repoId: number;
};

export function woodpeckerConfigFromEnv(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): WoodpeckerConfig {
  const baseUrl = z
    .url({ protocol: /^https?$/ })
    .parse(environment["WOODPECKER_URL"] ?? WOODPECKER_URL);
  const token = environment["WOODPECKER_TOKEN"];
  if (token === undefined || token.trim() === "")
    throw new Error("WOODPECKER_TOKEN is required");
  const repoId = z.coerce
    .number()
    .int()
    .positive()
    .parse(environment["WOODPECKER_REPO_ID"] ?? "1");
  return { baseUrl, token, repoId };
}

export async function loadWoodpeckerConfig(): Promise<WoodpeckerConfig> {
  if (Bun.env["WOODPECKER_TOKEN"] !== undefined)
    return woodpeckerConfigFromEnv();
  const base = Bun.env["WOODPECKER_URL"] ?? WOODPECKER_URL;
  const repo = Bun.env["WOODPECKER_REPO_ID"] ?? "1";
  if (base !== WOODPECKER_URL || repo !== "1") {
    throw new Error("Custom Woodpecker connections require WOODPECKER_TOKEN");
  }
  await resolveCredentials(["WOODPECKER_TOKEN"]);
  return woodpeckerConfigFromEnv();
}

export class WoodpeckerHttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Woodpecker request failed (${String(status)}): ${path}`);
  }
}

export async function woodpeckerRequest(
  path: string,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(new URL(path, config.baseUrl), {
    headers: { authorization: `Bearer ${config.token}` },
    redirect: "error",
    signal:
      signal === undefined
        ? AbortSignal.timeout(30_000)
        : AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new WoodpeckerHttpError(response.status, path);
  return response;
}

export async function woodpeckerJson(
  path: string,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await woodpeckerRequest(path, config, signal);
  return response.json();
}

type PipelineEvent =
  "pull_request" | "pull_request_metadata" | "push" | "manual";

/** Filter and paginate by event AND PR ref. */
export async function listPipelines(
  config: WoodpeckerConfig,
  filter: {
    event: PipelineEvent | readonly PipelineEvent[];
    prNumber?: number;
    branch?: string;
    stopWhen?: (pipelines: readonly z.infer<typeof SummarySchema>[]) => boolean;
  },
  signal?: AbortSignal,
): Promise<z.infer<typeof SummarySchema>[]> {
  const events: readonly string[] =
    typeof filter.event === "string" ? [filter.event] : filter.event;
  const query = new URLSearchParams({ event: events.join(","), perPage: "50" });
  if (filter.prNumber !== undefined)
    query.set("ref", `refs/pull/${String(filter.prNumber)}/`);
  if (filter.branch !== undefined) query.set("branch", filter.branch);
  const pipelines: z.infer<typeof SummarySchema>[] = [];
  for (let page = 1; ; page++) {
    query.set("page", String(page));
    const entries = z
      .array(SummarySchema.extend({ event: z.string(), ref: z.string() }))
      .parse(
        await woodpeckerJson(
          `/api/repos/${String(config.repoId)}/pipelines?${query.toString()}`,
          config,
          signal,
        ),
      );
    pipelines.push(
      ...entries.filter(
        (entry) =>
          events.includes(entry.event) &&
          (filter.prNumber === undefined ||
            entry.ref.startsWith(`refs/pull/${String(filter.prNumber)}/`)) &&
          (filter.branch === undefined || entry.branch === filter.branch),
      ),
    );
    if (entries.length < 50 || filter.stopWhen?.(pipelines) === true)
      return pipelines.toSorted((a, b) => b.number - a.number);
  }
}

export async function getPipeline(
  number: number,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<WoodpeckerPipeline> {
  const pipeline = WoodpeckerPipelineSchema.parse(
    await woodpeckerJson(
      `/api/repos/${String(config.repoId)}/pipelines/${String(number)}`,
      config,
      signal,
    ),
  );
  if (pipeline.number !== number)
    throw new Error("Woodpecker returned the wrong pipeline");
  return pipeline;
}

export function isPrVerificationPipeline(pipeline: {
  readonly event?: string | undefined;
  readonly event_reason?: readonly string[] | null | undefined;
  readonly pr_draft?: boolean | undefined;
}): boolean {
  return (
    pipeline.event === "pull_request" ||
    (pipeline.event === "pull_request_metadata" &&
      pipeline.pr_draft !== true &&
      pipeline.event_reason?.includes("ready_for_review") === true)
  );
}

export async function getWoodpeckerPipelineForCommit(
  headSha: string,
  config: WoodpeckerConfig = woodpeckerConfigFromEnv(),
  prNumber?: number,
  signal?: AbortSignal,
): Promise<WoodpeckerPipeline | null> {
  const lists = await Promise.all(
    (["pull_request", "pull_request_metadata"] as const).map((event) =>
      listPipelines(
        config,
        {
          event,
          ...(prNumber === undefined ? {} : { prNumber }),
          stopWhen: (entries) =>
            entries.some(
              (entry) =>
                entry.commit === headSha && isPrVerificationPipeline(entry),
            ),
        },
        signal,
      ),
    ),
  );
  const newest = lists
    .flat()
    .filter(
      (pipeline) =>
        pipeline.commit === headSha && isPrVerificationPipeline(pipeline),
    )
    .toSorted((a, b) => b.number - a.number)[0];
  if (newest === undefined) return null;
  const pipeline = await getPipeline(newest.number, config, signal);
  if (
    pipeline.commit !== headSha ||
    !isPrVerificationPipeline(pipeline) ||
    (prNumber !== undefined &&
      pipeline.ref?.startsWith(`refs/pull/${String(prNumber)}/`) !== true)
  ) {
    throw new Error(
      `Woodpecker pipeline #${String(pipeline.number)} does not match the expected PR head`,
    );
  }
  return pipeline;
}

export function pipelineUrl(
  pipeline: Pick<WoodpeckerPipeline, "number">,
  config: WoodpeckerConfig,
): string {
  return `${config.baseUrl}/repos/${String(config.repoId)}/pipeline/${String(pipeline.number)}`;
}
