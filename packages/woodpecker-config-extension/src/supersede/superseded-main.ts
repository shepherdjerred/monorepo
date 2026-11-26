import { z } from "zod";
import type { FetchLike } from "#src/http.ts";
import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import type { Pipeline } from "#src/schemas.ts";
import type { WoodpeckerApiOptions } from "#src/woodpecker-api.ts";

const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;

const PLACEHOLDER_IMAGES: CiImages = {
  base: `docker.io/shepherdjerred/ci-base@${PLACEHOLDER_DIGEST}`,
  playwright: `docker.io/shepherdjerred/ci-playwright@${PLACEHOLDER_DIGEST}`,
  catalog: {
    "aquasec/trivy": "aquasec/trivy:0",
    "semgrep/semgrep": "semgrep/semgrep:0",
    "texlive/texlive": "texlive/texlive:0",
    "trmnl/trmnlp": "trmnl/trmnlp:0",
    "grafana/tempo": "grafana/tempo:0",
    "mikefarah/yq": "mikefarah/yq:0",
    "pgsty/silo": "pgsty/silo:0",
    "plexinc/pms-docker": "plexinc/pms-docker:0",
  },
};

function dependsOnVerify(
  key: string,
  stepByKey: ReadonlyMap<string, CiStep>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  const step = stepByKey.get(key);
  for (const dependency of step?.dependsOn ?? []) {
    if (
      dependency === "verify" ||
      dependsOnVerify(dependency, stepByKey, seen)
    ) {
      return true;
    }
  }
  return false;
}

function buildWorkflowPartition() {
  const publication = new Set<string>();
  const prePublication = new Set<string>();
  for (const deliveryCatalogV2 of [false, true]) {
    const steps = buildPipelineSteps({
      deliveryPublication: true,
      deliveryCatalogV2,
      images: PLACEHOLDER_IMAGES,
      changedBase: "",
      imageReleaseBase: "",
    });
    const stepByKey = new Map(steps.map((step) => [step.key, step]));
    for (const step of steps) {
      if (
        step.defaultBranchOnly === true &&
        dependsOnVerify(step.key, stepByKey)
      ) {
        publication.add(step.key);
      } else {
        prePublication.add(step.key);
      }
    }
  }
  return { publication, prePublication };
}

const WORKFLOW_PARTITION = buildWorkflowPartition();

export function publicationWorkflowKeys(): ReadonlySet<string> {
  return WORKFLOW_PARTITION.publication;
}

const WorkflowStateSchema = z.looseObject({
  name: z.string(),
  state: z.string(),
  started: z.number().int().nonnegative().optional(),
});

const ActiveMainSummarySchema = z.looseObject({
  number: z.number().int().positive(),
  commit: z.string(),
  ref: z.string(),
  branch: z.string(),
  event: z.string(),
  status: z.string(),
});

const ActiveMainDetailSchema = ActiveMainSummarySchema.extend({
  workflows: z.array(WorkflowStateSchema).default([]),
});

const GitHubCompareStatusSchema = z.looseObject({
  status: z.string(),
});

type ActiveMainSummary = z.infer<typeof ActiveMainSummarySchema>;
type ActiveMainDetail = z.infer<typeof ActiveMainDetailSchema>;

const STARTED_WORKFLOW_STATES = new Set([
  "running",
  "started",
  "success",
  "failure",
  "error",
]);

export function hasStartedPublicationWorkflow(
  workflows: readonly z.infer<typeof WorkflowStateSchema>[],
): boolean {
  return workflows.some((workflow) => {
    const isPublication =
      WORKFLOW_PARTITION.publication.has(workflow.name) ||
      !WORKFLOW_PARTITION.prePublication.has(workflow.name);
    return (
      isPublication &&
      ((workflow.started ?? 0) > 0 ||
        STARTED_WORKFLOW_STATES.has(workflow.state.toLowerCase()))
    );
  });
}

export type KeptPipelineReason = "publishing" | "oldest-running" | "not-ahead";

export type KeptPipeline = {
  readonly number: number;
  readonly reason: KeptPipelineReason;
};

export type SupersededMainLog = {
  readonly component: "superseded-main";
  readonly currentPipeline: number;
  readonly canceledPipelines: readonly number[];
  readonly keptPipelines: readonly KeptPipeline[];
};

export type CancelSupersededMainInput = {
  readonly repoId: number;
  readonly defaultBranch: string;
  readonly current: Pick<Pipeline, "number" | "commit" | "branch" | "event">;
  readonly woodpecker: WoodpeckerApiOptions;
  readonly github: {
    readonly repo: string;
    readonly token: string;
    readonly fetchImpl?: FetchLike;
  };
  readonly log?: (event: SupersededMainLog) => void;
};

function createWoodpeckerClient(options: WoodpeckerApiOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(5000);
  const request = async (path: string, method = "GET") => {
    const response = await fetchImpl(new URL(path, options.baseUrl), {
      method,
      headers: { authorization: `Bearer ${options.token}` },
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Main supersession API returned ${response.status.toString()}`,
      );
    }
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

function isOlderMainPush(
  entry: ActiveMainSummary,
  currentNumber: number,
  defaultBranch: string,
): boolean {
  return (
    entry.number < currentNumber &&
    entry.event === "push" &&
    entry.branch === defaultBranch &&
    entry.ref === `refs/heads/${defaultBranch}` &&
    ["pending", "running"].includes(entry.status)
  );
}

async function collectCandidatesForStatus(input: {
  api: ReturnType<typeof createWoodpeckerClient>;
  prefix: string;
  status: string;
  currentNumber: number;
  defaultBranch: string;
  candidates: Map<number, ActiveMainSummary>;
}): Promise<void> {
  const { api, prefix, status, currentNumber, defaultBranch, candidates } =
    input;
  for (let page = 1; page <= 5; page++) {
    const query = new URLSearchParams({
      event: "push",
      branch: defaultBranch,
      status,
      perPage: "50",
      page: page.toString(),
    });
    const listed = z
      .array(ActiveMainSummarySchema)
      .parse(await api.json(`${prefix}?${query.toString()}`));
    for (const entry of listed) {
      if (isOlderMainPush(entry, currentNumber, defaultBranch)) {
        candidates.set(entry.number, entry);
      }
    }
    if (listed.length < 50) return;
  }
  throw new Error(
    "Main supersession exceeded its bounded active-pipeline scan",
  );
}

async function listActiveCandidates(
  api: ReturnType<typeof createWoodpeckerClient>,
  prefix: string,
  currentNumber: number,
  defaultBranch: string,
): Promise<ActiveMainSummary[]> {
  const candidates = new Map<number, ActiveMainSummary>();
  for (const status of ["running", "pending"]) {
    await collectCandidatesForStatus({
      api,
      prefix,
      status,
      currentNumber,
      defaultBranch,
      candidates,
    });
  }
  return [...candidates.values()].toSorted((a, b) => a.number - b.number);
}

async function loadActiveDetails(
  api: ReturnType<typeof createWoodpeckerClient>,
  prefix: string,
  summaries: readonly ActiveMainSummary[],
): Promise<ActiveMainDetail[]> {
  const details: ActiveMainDetail[] = [];
  for (const summary of summaries) {
    const detail = ActiveMainDetailSchema.parse(
      await api.json(`${prefix}/${summary.number.toString()}`),
    );
    if (["pending", "running"].includes(detail.status)) {
      details.push(detail);
    }
  }
  return details;
}

async function isCurrentStrictlyAhead(
  github: CancelSupersededMainInput["github"],
  baseCommit: string,
  headCommit: string,
): Promise<boolean> {
  if (
    baseCommit === headCommit ||
    !/^[a-f0-9]{40}$/u.test(baseCommit) ||
    !/^[a-f0-9]{40}$/u.test(headCommit)
  ) {
    return false;
  }
  const fetchImpl = github.fetchImpl ?? fetch;
  const url = new URL(
    `https://api.github.com/repos/${github.repo}/compare/${baseCommit}...${headCommit}`,
  );
  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${github.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const parsed = GitHubCompareStatusSchema.safeParse(await response.json());
    return parsed.success && parsed.data.status === "ahead";
  } catch {
    return false;
  }
}

async function revalidateAndCancel(input: {
  api: ReturnType<typeof createWoodpeckerClient>;
  prefix: string;
  candidate: ActiveMainDetail;
  defaultBranch: string;
  needProtectedRunner: boolean;
}): Promise<"canceled" | "settled" | KeptPipelineReason> {
  const { api, prefix, candidate, defaultBranch, needProtectedRunner } = input;
  const path = `${prefix}/${candidate.number.toString()}`;
  const fresh = ActiveMainDetailSchema.parse(await api.json(path));
  if (
    fresh.number !== candidate.number ||
    fresh.event !== "push" ||
    fresh.branch !== defaultBranch ||
    fresh.commit !== candidate.commit
  ) {
    throw new Error("Main supersession identity changed during revalidation");
  }
  if (!["pending", "running"].includes(fresh.status)) return "settled";
  if (hasStartedPublicationWorkflow(fresh.workflows)) return "publishing";
  if (needProtectedRunner && fresh.status === "running") {
    return "oldest-running";
  }
  try {
    await api.request(`${path}/cancel`, "POST");
    return "canceled";
  } catch (error) {
    const after = ActiveMainDetailSchema.parse(await api.json(path));
    if (
      after.number !== fresh.number ||
      after.commit !== fresh.commit ||
      ["pending", "running"].includes(after.status)
    ) {
      throw error;
    }
    return "settled";
  }
}

function partitionCandidates(details: readonly ActiveMainDetail[]) {
  const keptPipelines: KeptPipeline[] = [];
  const cancelable: ActiveMainDetail[] = [];
  for (const detail of details) {
    if (hasStartedPublicationWorkflow(detail.workflows)) {
      keptPipelines.push({ number: detail.number, reason: "publishing" });
    } else {
      cancelable.push(detail);
    }
  }
  let protectedProgressCount = keptPipelines.length;
  if (protectedProgressCount === 0) {
    const oldestRunning = cancelable.find(
      (detail) => detail.status === "running",
    );
    if (oldestRunning !== undefined) {
      keptPipelines.push({
        number: oldestRunning.number,
        reason: "oldest-running",
      });
      protectedProgressCount = 1;
    }
  }
  const keptNumbers = new Set(keptPipelines.map((entry) => entry.number));
  return {
    keptPipelines,
    protectedProgressCount,
    remaining: cancelable.filter((detail) => !keptNumbers.has(detail.number)),
  };
}

/**
 * Coalesces pre-publication `push main` runs while preserving forward progress:
 * never cancels a pipeline that started any post-`verify` default-branch
 * publication workflow, and keeps the oldest `running` pipeline when zero
 * active runs are publishing.
 */
export async function cancelSupersededMain(
  input: CancelSupersededMainInput,
): Promise<SupersededMainLog> {
  const { repoId, defaultBranch, current, woodpecker, github } = input;
  const emitLog =
    input.log ??
    ((entry: SupersededMainLog) => {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    });
  if (
    current.number < 1 ||
    current.event !== "push" ||
    current.branch !== defaultBranch
  ) {
    return {
      component: "superseded-main",
      currentPipeline: current.number,
      canceledPipelines: [],
      keptPipelines: [],
    };
  }
  const api = createWoodpeckerClient(woodpecker);
  const prefix = `/api/repos/${repoId.toString()}/pipelines`;
  const summaries = await listActiveCandidates(
    api,
    prefix,
    current.number,
    defaultBranch,
  );
  const details = await loadActiveDetails(api, prefix, summaries);
  const partitioned = partitionCandidates(details);
  const keptPipelines = [...partitioned.keptPipelines];
  let protectedProgressCount = partitioned.protectedProgressCount;
  const canceledPipelines: number[] = [];

  for (const candidate of partitioned.remaining) {
    const ahead = await isCurrentStrictlyAhead(
      github,
      candidate.commit,
      current.commit,
    );
    if (!ahead) {
      keptPipelines.push({ number: candidate.number, reason: "not-ahead" });
      continue;
    }
    const outcome = await revalidateAndCancel({
      api,
      prefix,
      candidate,
      defaultBranch,
      needProtectedRunner: protectedProgressCount === 0,
    });
    if (outcome === "canceled") {
      canceledPipelines.push(candidate.number);
    } else if (outcome !== "settled") {
      keptPipelines.push({ number: candidate.number, reason: outcome });
      if (outcome === "publishing" || outcome === "oldest-running") {
        protectedProgressCount += 1;
      }
    }
  }

  const result: SupersededMainLog = {
    component: "superseded-main",
    currentPipeline: current.number,
    canceledPipelines,
    keptPipelines: keptPipelines.toSorted((a, b) => a.number - b.number),
  };
  emitLog(result);
  return result;
}

export async function cleanupSupersededMain(input: {
  readonly repoId: number;
  readonly pipeline: Pipeline;
  readonly defaultBranch: string;
  readonly enabled?: (() => Promise<boolean>) | undefined;
  readonly cancel?:
    | ((
        repoId: number,
        pipeline: Pipeline,
        defaultBranch: string,
      ) => Promise<unknown>)
    | undefined;
}): Promise<void> {
  const { repoId, pipeline, defaultBranch, enabled, cancel } = input;
  if (pipeline.event !== "push" || pipeline.branch !== defaultBranch) return;
  try {
    if ((await enabled?.()) !== true) return;
    await cancel?.(repoId, pipeline, defaultBranch);
  } catch {
    console.warn(
      "Main supersession cleanup failed; preserving current pipeline",
    );
  }
}
