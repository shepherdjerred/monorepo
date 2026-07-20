import { z } from "zod";

const IsoTimestampSchema = z.iso.datetime({ offset: true });

const BuildStateSchema = z.enum([
  "blocked",
  "canceled",
  "canceling",
  "creating",
  "failed",
  "failing",
  "not_run",
  "passed",
  "running",
  "scheduled",
  "skipped",
]);

const JobStateSchema = z.enum([
  "accepted",
  "assigned",
  "blocked",
  "broken",
  "canceled",
  "canceling",
  "finished",
  "failed",
  "limiting",
  "not_run",
  "passed",
  "running",
  "scheduled",
  "skipped",
  "timed_out",
  "timing_out",
  "unblocked",
  "waiting",
  "waiting_failed",
]);

export const BuildkiteJobSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  step_key: z.string().min(1).nullable(),
  state: JobStateSchema,
  started_at: IsoTimestampSchema.nullable(),
  finished_at: IsoTimestampSchema.nullable(),
  web_url: z.url(),
  exit_status: z.number().int().nullable(),
});

export const BuildkiteBuildSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  state: BuildStateSchema,
  branch: z.string().min(1),
  created_at: IsoTimestampSchema,
  started_at: IsoTimestampSchema.nullable(),
  finished_at: IsoTimestampSchema.nullable(),
  web_url: z.url(),
  jobs: z.array(BuildkiteJobSchema),
});

const BuildkiteBuildListSchema = z.array(BuildkiteBuildSchema);

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

export type BuildkiteBuild = z.infer<typeof BuildkiteBuildSchema>;
export type BuildkiteJob = z.infer<typeof BuildkiteJobSchema>;
export type PrometheusVector = z.infer<
  typeof PrometheusSuccessSchema
>["data"]["result"];

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type BuildkiteClientConfig = {
  apiBaseUrl: string;
  organization: string;
  pipeline: string;
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

function buildkiteHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function pipelineBuildsUrl(config: BuildkiteClientConfig): URL {
  const base = config.apiBaseUrl.endsWith("/")
    ? config.apiBaseUrl
    : `${config.apiBaseUrl}/`;
  return new URL(
    `organizations/${encodeURIComponent(config.organization)}/pipelines/${encodeURIComponent(config.pipeline)}/builds`,
    base,
  );
}

export async function fetchBuildkiteBuild(
  config: BuildkiteClientConfig,
  buildNumber: number,
): Promise<BuildkiteBuild> {
  const url = pipelineBuildsUrl(config);
  url.pathname = `${url.pathname}/${String(buildNumber)}`;
  const response = await config.fetcher(url.toString(), {
    headers: buildkiteHeaders(config.token),
  });
  const body = await readJson(
    response,
    `Buildkite build ${String(buildNumber)}`,
  );
  return BuildkiteBuildSchema.parse(body);
}

export async function fetchBuildkiteBuilds(
  config: BuildkiteClientConfig,
  window: TimeWindow,
): Promise<BuildkiteBuild[]> {
  const builds: BuildkiteBuild[] = [];
  const perPage = 100;

  for (let page = 1; page <= 1000; page += 1) {
    const url = pipelineBuildsUrl(config);
    url.searchParams.set("created_from", window.from.toISOString());
    url.searchParams.set("created_to", window.to.toISOString());
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const response = await config.fetcher(url.toString(), {
      headers: buildkiteHeaders(config.token),
    });
    const body = await readJson(
      response,
      `Buildkite builds page ${String(page)}`,
    );
    const pageBuilds = BuildkiteBuildListSchema.parse(body);
    builds.push(...pageBuilds);
    if (pageBuilds.length < perPage) {
      return builds;
    }
  }

  throw new Error("Buildkite pagination exceeded 1000 pages");
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

  const response = await config.fetcher(url.toString(), {
    headers: prometheusHeaders(config.bearerToken),
  });
  const body = await readJson(response, "Prometheus query");
  const parsed = PrometheusResponseSchema.parse(body);
  if (parsed.status === "error") {
    throw new Error(`Prometheus API error: ${parsed.errorType}`);
  }
  return parsed.data.result;
}
