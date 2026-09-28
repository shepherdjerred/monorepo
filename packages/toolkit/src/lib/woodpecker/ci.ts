import { z } from "zod";

/**
 * Woodpecker client for PR health.
 *
 * Talks to the REST API directly rather than shelling out to a CLI, which the
 * Buildkite client had to do. That removes a binary from the operator's
 * machine and makes the failure modes legible: an unreachable server or a
 * rejected token is an HTTP status, not a subprocess exit code.
 */

const WoodpeckerWorkflowSchema = z.object({
  name: z.string(),
  state: z.string(),
});

const WoodpeckerPipelineSummarySchema = z.object({
  number: z.number(),
  commit: z.string(),
  status: z.string(),
});

const WoodpeckerPipelineSchema = WoodpeckerPipelineSummarySchema.extend({
  workflows: z.array(WoodpeckerWorkflowSchema).default([]),
});

export type WoodpeckerPipeline = z.infer<typeof WoodpeckerPipelineSchema>;

export type WoodpeckerConfig = {
  readonly baseUrl: string;
  readonly token: string;
  readonly repoId: number;
};

/**
 * Read connection details from the environment.
 *
 * Fails loudly rather than defaulting: a health check that silently talks to
 * the wrong instance, or reports "no build" because it was never configured,
 * is worse than one that refuses to run.
 */
export function woodpeckerConfigFromEnv(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): WoodpeckerConfig {
  // WOODPECKER_URL, not WOODPECKER_SERVER: upstream gives that name two
  // meanings -- the CLI's HTTP address and the agent's gRPC endpoint -- so
  // this repository keeps the HTTP origin under a name with one meaning and
  // lets the passthrough hand the CLI its own value.
  const baseUrl = environment["WOODPECKER_URL"];
  const token = environment["WOODPECKER_TOKEN"];
  const repoId = environment["WOODPECKER_REPO_ID"];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("WOODPECKER_URL is required");
  }
  if (token === undefined || token.length === 0) {
    throw new Error("WOODPECKER_TOKEN is required");
  }
  const parsedRepoId = Number(repoId);
  if (!Number.isInteger(parsedRepoId) || parsedRepoId <= 0) {
    throw new Error("WOODPECKER_REPO_ID must be a positive integer");
  }
  return { baseUrl, token, repoId: parsedRepoId };
}

async function getJson(
  path: string,
  config: WoodpeckerConfig,
): Promise<unknown> {
  const response = await fetch(new URL(path, config.baseUrl), {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) {
    throw new Error(
      `Woodpecker request failed (${String(response.status)}): ${path}`,
    );
  }
  return response.json();
}

/**
 * Newest pipeline for an exact commit, or null when none exists.
 *
 * Filters on the commit again after listing rather than trusting the query:
 * reporting a different commit's result as this PR's head would defeat the
 * whole point of the check.
 */
export async function getWoodpeckerPipelineForCommit(
  headSha: string,
  config: WoodpeckerConfig = woodpeckerConfigFromEnv(),
): Promise<WoodpeckerPipeline | null> {
  const listed = z
    .array(WoodpeckerPipelineSummarySchema)
    .parse(
      await getJson(
        `/api/repos/${String(config.repoId)}/pipelines?perPage=50`,
        config,
      ),
    );
  const newest = listed
    .filter((pipeline) => pipeline.commit === headSha)
    .toSorted((left, right) => right.number - left.number)[0];
  if (newest === undefined) {
    return null;
  }

  const pipeline = WoodpeckerPipelineSchema.parse(
    await getJson(
      `/api/repos/${String(config.repoId)}/pipelines/${String(newest.number)}`,
      config,
    ),
  );
  if (pipeline.commit !== headSha) {
    throw new Error(
      `Woodpecker pipeline #${String(pipeline.number)} is for ${pipeline.commit}, expected ${headSha}`,
    );
  }
  return pipeline;
}

export function pipelineUrl(
  pipeline: WoodpeckerPipeline,
  config: WoodpeckerConfig,
): string {
  return `${config.baseUrl}/repos/${String(config.repoId)}/pipeline/${String(pipeline.number)}`;
}
