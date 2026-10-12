import { createHash } from "node:crypto";
import { z } from "zod";
import { Octokit } from "octokit";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import type {
  MaintenanceCandidate,
  MaintenanceRequest,
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
export async function currentMaintenanceSource(github: Octokit) {
  const branch = await github.rest.repos.getBranch({ ...REPO, branch: "main" });
  return branch.data.commit.sha;
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
    signal: AbortSignal.timeout(15_000),
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
export async function maintenancePipeline(number: number) {
  return MaintenancePipelineSchema.parse(
    await maintenanceApi(`/${number.toString()}`),
  );
}
export function isCompleteMain(pipeline: MaintenancePipeline, source: string) {
  return (
    pipeline.commit === source &&
    pipeline.status === "success" &&
    pipeline.ref === "refs/heads/main" &&
    ["push", "manual"].includes(pipeline.event) &&
    pipeline.workflows.every((workflow) => workflow.state === "success") &&
    [
      "verify",
      "homelab-release-admission",
      "images",
      "helm-push",
      "argocd-sync",
    ].every((name) =>
      pipeline.workflows.some((workflow) => workflow.name === name),
    )
  );
}
export async function verifiedMaintenanceSource(source: string) {
  const recent = await recentMaintenancePipelines("push,manual");
  const candidates = recent.filter(
    (pipeline) => pipeline.commit === source && pipeline.status === "success",
  );
  for (const candidate of candidates)
    if (isCompleteMain(await maintenancePipeline(candidate.number), source))
      return true;
  return false;
}

const IMAGE_INPUTS = [
  ".mise.toml",
  "ci/ci-image/Dockerfile",
  "ci/ci-playwright/Dockerfile",
];
export function imageMaintenanceFingerprint(
  tree: readonly { path?: string; sha?: string }[],
) {
  const hash = createHash("sha256");
  for (const path of IMAGE_INPUTS) {
    const sha = tree.find((entry) => entry.path === path)?.sha;
    if (sha === undefined) throw new Error(`Missing CI image input ${path}`);
    hash.update(`${path}\0${sha}\0`);
  }
  return hash.digest("hex");
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
  return {
    number: receipt.number,
    source: receipt.commit,
    status: receipt.status,
    ...(receipt.status === "success" && receipt.commit === request.source
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
    ?.children?.find((child) => child.name === name);
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
