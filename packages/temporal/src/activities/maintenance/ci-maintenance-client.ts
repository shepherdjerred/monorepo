import { createHash } from "node:crypto";
import { z } from "zod";
import { Octokit } from "octokit";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  ciWorkspaceGoldenRefreshEnabled,
  ciWorkspaceSeedRefreshEnabled,
} from "#config/ci-maintenance.ts";
import {
  isActiveMaintenanceStatus,
  type MaintenanceCandidate,
  type MaintenanceRequest,
} from "#shared/ci-maintenance.ts";

const StatusSchema = z.enum([
  "created",
  "pending",
  "running",
  "blocked",
  "success",
  "failure",
  "error",
  "killed",
  "canceled",
  "declined",
  "skipped",
]);
export const MaintenancePipelineSchema = z.object({
  number: z.number().int().positive(),
  commit: z.string(),
  status: StatusSchema,
  event: z.string(),
  branch: z.string(),
  ref: z.string(),
  message: z.string(),
  workflows: z
    .array(
      z.object({
        name: z.string(),
        state: StatusSchema,
        children: z
          .array(
            z.object({ id: z.number().int().positive(), name: z.string() }),
          )
          .optional(),
      }),
    )
    .default([]),
});
export type MaintenancePipeline = z.infer<typeof MaintenancePipelineSchema>;
const REPO = { owner: "shepherdjerred", repo: "monorepo" };
const required = (key: string): string => {
  const value = Bun.env[key];
  if (value === undefined || value === "")
    throw new Error(`${key} is required for CI maintenance`);
  return value;
};
export async function maintenanceGithub() {
  const { token } = await createGitHubAppInstallationToken();
  return new Octokit({ auth: token, request: { timeout: 15_000 } });
}
export async function maintenanceApi(
  path: string,
  init: RequestInit = {},
  route = "pipelines",
) {
  const base = new URL(
    `/api/repos/${required("WOODPECKER_REPO_ID")}/${route}${path}`,
    required("WOODPECKER_URL"),
  );
  const response = await fetch(base, {
    ...init,
    headers: {
      Authorization: `Bearer ${required("WOODPECKER_TOKEN")}`,
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal:
      init.signal === undefined || init.signal === null
        ? AbortSignal.timeout(15_000)
        : AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok)
    throw new Error(
      `Woodpecker maintenance HTTP ${response.status.toString()}`,
    );
  return response.json();
}

export async function recentMaintenancePipelines(event: string) {
  const rows: MaintenancePipeline[] = [];
  for (let page = 1; page <= 4; page++) {
    const query = new URLSearchParams({
      event,
      branch: "main",
      perPage: "50",
      page: page.toString(),
    });
    const batch = z
      .array(MaintenancePipelineSchema)
      .parse(await maintenanceApi(`?${query.toString()}`));
    rows.push(...batch);
    if (batch.length < 50) break;
  }
  return [...new Map(rows.map((row) => [row.number, row])).values()];
}

export async function maintenanceAdmissionBusy(): Promise<boolean> {
  // Bound all four indexed active-status reads to one budget, below both
  // Activity deadlines. Historical receipt reconciliation stays separate.
  const signal = AbortSignal.timeout(10_000);
  const results = await Promise.all(
    ["created", "pending", "running", "blocked"].map(async (status) => {
      const query = new URLSearchParams({
        event: "manual",
        status,
        perPage: "50",
        page: "1",
      });
      const pipelines = z
        .array(MaintenancePipelineSchema)
        .parse(await maintenanceApi(`?${query.toString()}`, { signal }));
      if (
        pipelines.some(
          (pipeline) =>
            pipeline.event !== "manual" || pipeline.status !== status,
        )
      )
        throw new Error("CI maintenance active-status filter was not applied");
      // A saturated page is busy, never evidence that a hidden canary is absent.
      return (
        pipelines.length >= 50 ||
        pipelines.some((pipeline) => isActiveMaintenanceOrCanary(pipeline))
      );
    }),
  );
  return results.includes(true);
}

/** Active manual canaries defer new automatic maintenance submissions. */
export function isActiveMaintenanceOrCanary(pipeline: MaintenancePipeline) {
  return (
    pipeline.event === "manual" &&
    isActiveMaintenanceStatus(pipeline.status) &&
    ((pipeline.branch === "main" &&
      pipeline.message.includes("ci-maintenance/")) ||
      pipeline.branch.startsWith("ci-canary/"))
  );
}
export async function maintenancePipeline(number: number) {
  return MaintenancePipelineSchema.parse(
    await maintenanceApi(`/${number.toString()}`),
  );
}
// The workflows every main push runs since Delivery v2: a pipeline without
// them did not build and register a release.
const COMPLETE_MAIN_WORKFLOWS = [
  "verify",
  "images",
  "helm-push",
  "delivery-publish",
];
export function isCompleteMain(pipeline: MaintenancePipeline, source: string) {
  return (
    pipeline.commit === source &&
    pipeline.status === "success" &&
    pipeline.ref === "refs/heads/main" &&
    ["push", "manual"].includes(pipeline.event) &&
    pipeline.workflows.every((workflow) => workflow.state === "success") &&
    COMPLETE_MAIN_WORKFLOWS.every((name) =>
      pipeline.workflows.some((workflow) => workflow.name === name),
    )
  );
}
/**
 * The newest main push whose pipeline succeeded, if that pipeline is a
 * complete main build. Main usually advances faster than its pipelines finish,
 * so maintenance runs on this commit rather than the branch tip. The config
 * extension selects the same commit (`lastSuccessfulCommit`) and checks it out
 * in place of the tip.
 */
export async function newestVerifiedMaintenanceSource(): Promise<
  string | undefined
> {
  const pushes = await recentMaintenancePipelines("push");
  const newest = pushes
    .filter(
      (pipeline) =>
        pipeline.status === "success" && pipeline.ref === "refs/heads/main",
    )
    .toSorted((a, b) => b.number - a.number)[0];
  if (newest === undefined) return undefined;
  return isCompleteMain(await maintenancePipeline(newest.number), newest.commit)
    ? newest.commit
    : undefined;
}

const IMAGE_INPUTS = [
  ".mise.toml",
  "mise.lock",
  "ci/ci-image/Dockerfile",
  "ci/ci-playwright/Dockerfile",
];
function treeFingerprint(
  tree: readonly { path?: string; sha?: string }[],
  inputs: readonly string[],
  label: string,
  hash = createHash("sha256"),
) {
  for (const path of inputs) {
    const sha = tree.find((entry) => entry.path === path)?.sha;
    if (sha === undefined) throw new Error(`Missing ${label} ${path}`);
    hash.update(`${path}\0${sha}\0`);
  }
  return hash.digest("hex");
}
export function imageMaintenanceFingerprint(
  tree: readonly { path?: string; sha?: string }[],
) {
  return treeFingerprint(tree, IMAGE_INPUTS, "CI image input");
}

// What a golden workspace's install depends on. Main's source moves on every
// merge, so the day bounds how far workspaces drift from their golden commit
// instead; each workspace still checks out and installs its own commit.
const GOLDEN_INPUTS = [
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "patches",
  ".mise.toml",
  "mise.lock",
  "ci/ci-image/Dockerfile",
];
export function goldenMaintenanceFingerprint(
  tree: readonly { path?: string; sha?: string }[],
  now: Date,
) {
  return treeFingerprint(
    tree,
    GOLDEN_INPUTS,
    "golden workspace input",
    createHash("sha256").update(`${now.toISOString().slice(0, 10)}\0`),
  );
}
async function frozenBranch(github: Octokit, branch: string) {
  const prs = await github.rest.pulls.list({
    ...REPO,
    state: "open",
    base: "main",
    head: `${REPO.owner}:${branch}`,
    per_page: 100,
  });
  if (prs.data.length > 1)
    throw new Error(`Multiple maintenance PRs for ${branch}`);
  return prs.data.some((pr) => pr.draft !== true);
}
export async function maintenanceCandidates(
  github: Octokit,
  source: string,
): Promise<MaintenanceCandidate[]> {
  const [tree, releaseFrozen, baseFrozen, browserFrozen] = await Promise.all([
    github.rest.git.getTree({ ...REPO, tree_sha: source, recursive: "1" }),
    frozenBranch(github, "release-please--branches--main"),
    frozenBranch(github, "chore/ci-base-pin-pending"),
    frozenBranch(github, "chore/ci-playwright-pin-pending"),
  ]);
  if (tree.data.truncated) throw new Error("GitHub source tree was truncated");
  return [
    {
      kind: "release-notes",
      source,
      fingerprint: source,
      frozen: releaseFrozen,
    },
    {
      kind: "ci-images",
      source,
      fingerprint: imageMaintenanceFingerprint(tree.data.tree),
      frozen: baseFrozen || browserFrozen,
    },
    ...((await ciWorkspaceSeedRefreshEnabled())
      ? [
          {
            kind: "workspace-seeds" as const,
            source,
            fingerprint: source,
            frozen: false,
          },
        ]
      : []),
    ...((await ciWorkspaceGoldenRefreshEnabled())
      ? [
          {
            kind: "workspace-golden" as const,
            source,
            fingerprint: goldenMaintenanceFingerprint(
              tree.data.tree,
              new Date(),
            ),
            frozen: false,
          },
        ]
      : []),
  ];
}
export async function findMaintenanceReceipt(
  request: MaintenanceRequest,
  recent: readonly MaintenancePipeline[],
) {
  const matches = recent.filter((pipeline) =>
    pipeline.message.includes(`ci-maintenance/${request.requestId}`),
  );
  if (matches.length > 1)
    throw new Error("Duplicate maintenance request receipts");
  const number = request.pipeline ?? matches[0]?.number;
  if (number === undefined) return null;
  const receipt = await maintenancePipeline(number);
  if (
    receipt.event !== "manual" ||
    receipt.branch !== "main" ||
    !receipt.message.includes(`ci-maintenance/${request.requestId}`)
  )
    throw new Error("Maintenance receipt identity mismatch");
  // Woodpecker runs a manual pipeline at the branch tip, and the extension
  // checks out the requested verified source in its place. It supersedes the
  // request instead when that source is no longer the verified one.
  const source = receipt.workflows.some(
    (workflow) => workflow.name === "maintenance-superseded",
  )
    ? receipt.commit
    : request.source;
  return {
    number: receipt.number,
    source,
    status: receipt.status,
    ...(receipt.status === "success" && source === request.source
      ? { deferred: await maintenanceWasDeferred(receipt, request.kind) }
      : {}),
  };
}

export function maintenanceResult(
  logs: readonly { data: string | null; line: number }[],
) {
  const lines = logs
    .toSorted((a, b) => a.line - b.line)
    .map((entry) =>
      entry.data === null ? "" : decodeMaintenanceLog(entry.data),
    )
    .join("\n")
    .split(/\r?\n/u);
  const records = lines.filter((line) =>
    line.startsWith("CI_MAINTENANCE_RESULT "),
  );
  if (records.length !== 1)
    throw new Error(
      "Successful maintenance is missing its unique result receipt",
    );
  return z
    .object({ status: z.enum(["completed", "deferred"]) })
    .parse(
      JSON.parse(records[0]?.slice("CI_MAINTENANCE_RESULT ".length) ?? ""),
    );
}

function decodeMaintenanceLog(data: string): string {
  if (Buffer.from(data, "base64").toString("base64") !== data)
    throw new Error("Malformed maintenance log encoding");
  return Buffer.from(data, "base64").toString("utf8");
}

async function maintenanceWasDeferred(
  pipeline: MaintenancePipeline,
  kind: string,
) {
  const name = `maintenance-${kind}`;
  const step = pipeline.workflows
    .find((workflow) => workflow.name === name)
    ?.children?.find(
      (child) =>
        child.name ===
        (kind === "workspace-seeds" ? "workspace-seeds-result" : name),
    );
  if (step === undefined)
    throw new Error("Maintenance receipt has no command step");
  const logs = z
    .array(z.object({ data: z.string().nullable(), line: z.number() }))
    .parse(
      await maintenanceApi(
        `/${pipeline.number.toString()}/${step.id.toString()}`,
        {},
        "logs",
      ),
    );
  return maintenanceResult(logs).status === "deferred";
}
