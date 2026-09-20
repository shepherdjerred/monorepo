import { z } from "zod";

/**
 * Woodpecker and Prometheus clients for the CI I/O benchmark.
 *
 * Woodpecker's model is pipeline -> workflow -> step, where the generated
 * pipeline gives every CI step its own single-step workflow. The rest of this
 * subsystem was written against Buildkite's flatter build -> job model, so the
 * fetchers below flatten workflows back into jobs rather than propagating the
 * extra level through aggregation, integrity checking and reporting.
 */

const PrometheusMetricSchema = z.record(z.string(), z.string());
const PrometheusSampleSchema = z.tuple([z.number(), z.string()]);

const PrometheusSuccessSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        metric: PrometheusMetricSchema,
        value: PrometheusSampleSchema,
      }),
    ),
  }),
});

const PrometheusErrorSchema = z.object({
  status: z.literal("error"),
  errorType: z.string().min(1),
  error: z.string().min(1),
});

const PrometheusResponseSchema = z.discriminatedUnion("status", [
  PrometheusSuccessSchema,
  PrometheusErrorSchema,
]);

/**
 * Woodpecker reports every timestamp as whole unix seconds, and uses 0 -- not
 * null and not an absent key -- for "has not happened yet". Zero is therefore
 * a sentinel, not a real instant, and is converted to null on the way in so
 * the rest of the pipeline never has to know that.
 */
const UnixSecondsSchema = z.number().int().nonnegative();

const WoodpeckerStepSchema = z.looseObject({
  id: z.number().int(),
  name: z.string().min(1),
  state: z.string().min(1),
  exit_code: z.number().int(),
  started: UnixSecondsSchema,
  finished: UnixSecondsSchema,
});

const WoodpeckerWorkflowSchema = z.looseObject({
  id: z.number().int(),
  name: z.string().min(1),
  state: z.string().min(1),
  started: UnixSecondsSchema,
  finished: UnixSecondsSchema,
  children: z.array(WoodpeckerStepSchema).default([]),
});

const WoodpeckerPipelineSchema = z.looseObject({
  number: z.number().int().positive(),
  commit: z.string().min(1),
  status: z.string().min(1),
  branch: z.string().min(1),
  created: UnixSecondsSchema,
  started: UnixSecondsSchema,
  finished: UnixSecondsSchema,
  workflows: z.array(WoodpeckerWorkflowSchema).default([]),
});

const WoodpeckerPipelineListSchema = z.array(
  z.looseObject({
    number: z.number().int().positive(),
    created: UnixSecondsSchema,
  }),
);

const FETCH_TIMEOUT_MILLISECONDS = 30_000;

/**
 * One CI step, as the rest of the benchmark understands it.
 *
 * `id` is `<commit>:<step key>` rather than an opaque identifier from the CI
 * provider. That is deliberate: it is exactly the pair the step pod carries as
 * Kubernetes labels, which is what lets a Prometheus series be attributed to a
 * step at all. Woodpecker's own step id is a per-instance integer that appears
 * nowhere in the telemetry.
 *
 * The pair is not unique across a retry of the same step on the same commit.
 * That collision is caught rather than hidden: two pods mapping to one job is
 * an integrity failure, and the benchmark refuses to report instead of
 * silently summing them.
 */
export type CiJob = {
  id: string;
  name: string;
  step_key: string | null;
  state: string;
  started_at: string | null;
  finished_at: string | null;
  web_url: string;
  exit_status: number | null;
};

export type CiBuild = {
  number: number;
  commit: string;
  state: string;
  branch: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  web_url: string;
  jobs: CiJob[];
};

export type PrometheusVector = z.infer<
  typeof PrometheusSuccessSchema
>["data"]["result"];

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type WoodpeckerClientConfig = {
  /** Origin of the Woodpecker server, e.g. https://woodpecker.sjer.red. */
  baseUrl: string;
  /** Numeric repository id, as Woodpecker's own API addresses repositories. */
  repoId: number;
  token: string;
  fetcher: Fetcher;
};

export type PrometheusClientConfig = {
  apiBaseUrl: string;
  bearerToken?: string;
  fetcher: Fetcher;
};

export type TimeWindow = {
  from: Date;
  to: Date;
};

async function readJson(response: Response, context: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  return body;
}

function bearerHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function requestInit(headers: Record<string, string>): RequestInit {
  return {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS),
  };
}

function pipelinesUrl(config: WoodpeckerClientConfig): URL {
  const base = config.baseUrl.endsWith("/")
    ? config.baseUrl
    : `${config.baseUrl}/`;
  return new URL(`api/repos/${String(config.repoId)}/pipelines`, base);
}

function timestamp(seconds: number): string | null {
  return seconds === 0 ? null : new Date(seconds * 1000).toISOString();
}

function requiredTimestamp(seconds: number, context: string): string {
  const value = timestamp(seconds);
  if (value === null) {
    throw new Error(`${context} has no creation timestamp`);
  }
  return value;
}

function pipelineUrl(config: WoodpeckerClientConfig, number: number): string {
  const base = config.baseUrl.replace(/\/$/, "");
  return `${base}/repos/${String(config.repoId)}/pipeline/${String(number)}`;
}

/**
 * Flatten a pipeline's workflows into jobs.
 *
 * The generated pipeline gives each CI step its own workflow containing one
 * step, so the workflow name is the step key. A workflow with a different
 * shape would mean the emitter changed without this being updated, so the
 * step key falls back to the workflow name rather than being invented.
 */
function toCiBuild(
  config: WoodpeckerClientConfig,
  pipeline: z.infer<typeof WoodpeckerPipelineSchema>,
): CiBuild {
  const url = pipelineUrl(config, pipeline.number);
  const jobs = pipeline.workflows.flatMap((workflow) =>
    workflow.children.map((step) => ({
      id: `${pipeline.commit}:${workflow.name}`,
      name: step.name,
      step_key: workflow.name,
      state: step.state,
      started_at: timestamp(step.started),
      finished_at: timestamp(step.finished),
      web_url: `${url}/${String(workflow.id)}`,
      // Woodpecker reports 0 for a step that never ran as well as for one that
      // succeeded, so an exit status is only meaningful once the step finished.
      exit_status: step.finished === 0 ? null : step.exit_code,
    })),
  );
  return {
    number: pipeline.number,
    commit: pipeline.commit,
    state: pipeline.status,
    branch: pipeline.branch,
    created_at: requiredTimestamp(
      pipeline.created,
      `Woodpecker pipeline ${String(pipeline.number)}`,
    ),
    started_at: timestamp(pipeline.started),
    finished_at: timestamp(pipeline.finished),
    web_url: url,
    jobs,
  };
}

export async function fetchCiBuild(
  config: WoodpeckerClientConfig,
  buildNumber: number,
): Promise<CiBuild> {
  const url = pipelinesUrl(config);
  url.pathname = `${url.pathname}/${String(buildNumber)}`;
  const response = await config.fetcher(
    url.toString(),
    requestInit(bearerHeaders(config.token)),
  );
  const body = await readJson(
    response,
    `Woodpecker pipeline ${String(buildNumber)}`,
  );
  return toCiBuild(config, WoodpeckerPipelineSchema.parse(body));
}

/**
 * Every pipeline created inside `window`, with its workflows resolved.
 *
 * Woodpecker's list endpoint returns pipeline summaries without workflows, so
 * each one is fetched individually. `before`/`after` are applied server-side
 * and re-checked here: a server that ignored them would otherwise silently
 * widen the cohort the benchmark reports on.
 */
export async function fetchCiBuilds(
  config: WoodpeckerClientConfig,
  window: TimeWindow,
): Promise<CiBuild[]> {
  const perPage = 50;
  const numbers: number[] = [];

  for (let page = 1; page <= 1000; page += 1) {
    const url = pipelinesUrl(config);
    url.searchParams.set("after", window.from.toISOString());
    url.searchParams.set("before", window.to.toISOString());
    url.searchParams.set("perPage", String(perPage));
    url.searchParams.set("page", String(page));
    const response = await config.fetcher(
      url.toString(),
      requestInit(bearerHeaders(config.token)),
    );
    const body = await readJson(
      response,
      `Woodpecker pipelines page ${String(page)}`,
    );
    const summaries = WoodpeckerPipelineListSchema.parse(body);
    for (const summary of summaries) {
      const created = summary.created * 1000;
      if (created >= window.from.getTime() && created <= window.to.getTime()) {
        numbers.push(summary.number);
      }
    }
    if (summaries.length < perPage) {
      const builds: CiBuild[] = [];
      for (const number of numbers) {
        builds.push(await fetchCiBuild(config, number));
      }
      return builds;
    }
  }

  throw new Error("Woodpecker pagination exceeded 1000 pages");
}

function prometheusHeaders(token: string | undefined): Record<string, string> {
  if (token === undefined) {
    return { Accept: "application/json" };
  }
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function queryPrometheusVector(
  config: PrometheusClientConfig,
  query: string,
  time: Date,
): Promise<PrometheusVector> {
  const base = config.apiBaseUrl.endsWith("/")
    ? config.apiBaseUrl
    : `${config.apiBaseUrl}/`;
  const url = new URL("api/v1/query", base);
  url.searchParams.set("query", query);
  url.searchParams.set("time", String(time.getTime() / 1000));

  const response = await config.fetcher(
    url.toString(),
    requestInit(prometheusHeaders(config.bearerToken)),
  );
  const body = await readJson(response, "Prometheus query");
  const parsed = PrometheusResponseSchema.parse(body);
  if (parsed.status === "error") {
    throw new Error(`Prometheus API error: ${parsed.errorType}`);
  }
  return parsed.data.result;
}
