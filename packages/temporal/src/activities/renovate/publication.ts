import { Octokit } from "octokit";
import { z } from "zod/v4";
import {
  maintenanceApi,
  MaintenancePipelineSchema,
} from "#activities/maintenance/ci-maintenance-client.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import type { Publication } from "./store.ts";

export const RENOVATE_REPOSITORY = {
  owner: "shepherdjerred",
  repo: "monorepo",
};
export const MAIN_BRANCH = "main";
const REPO_SLUG = `${RENOVATE_REPOSITORY.owner}/${RENOVATE_REPOSITORY.repo}`;
const PULL_REQUEST_FILE_LIMIT = 3000;

const WoodpeckerQueueSchema = z.object({
  paused: z.boolean(),
  stats: z.object({
    worker_count: z.number(),
    pending_count: z.number(),
    running_count: z.number(),
    waiting_on_deps_count: z.number(),
  }),
});

export function woodpeckerHasRoom(
  queue: z.infer<typeof WoodpeckerQueueSchema>,
): boolean {
  const { stats } = queue;
  return (
    !queue.paused &&
    stats.pending_count === 0 &&
    stats.waiting_on_deps_count === 0 &&
    stats.running_count < stats.worker_count
  );
}

export async function woodpeckerAdmissionAvailable(): Promise<boolean> {
  const base = Bun.env["WOODPECKER_URL"];
  const token = Bun.env["WOODPECKER_TOKEN"];
  if (base === undefined || token === undefined)
    throw new Error("Woodpecker admission credentials are missing");
  const response = await fetch(new URL("/api/queue/info", base), {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `Woodpecker queue info returned HTTP ${String(response.status)}`,
    );
  return woodpeckerHasRoom(WoodpeckerQueueSchema.parse(await response.json()));
}

export async function hasWoodpeckerReceipt(
  prNumber: number,
  headSha: string,
): Promise<boolean> {
  const ref = `refs/pull/${String(prNumber)}/`;
  const query = new URLSearchParams({ ref, perPage: "50" });
  const pipelines = z
    .array(MaintenancePipelineSchema)
    .parse(await maintenanceApi(`?${query.toString()}`));
  return pipelines.some(
    (pipeline) =>
      pipeline.ref.startsWith(ref) &&
      pipeline.commit === headSha &&
      (pipeline.event === "pull_request" ||
        pipeline.event === "pull_request_metadata"),
  );
}

export type BundlePullRequest = {
  number: number;
  url: string;
  headSha: string;
  state: "open" | "merged" | "closed";
};

type RecoveredBundlePullRequest = BundlePullRequest & {
  baseSha: string;
  closedUnverified?: true;
};

function isNotFound(error: unknown): boolean {
  return z.object({ status: z.literal(404) }).safeParse(error).success;
}

export async function createRenovateGitHub() {
  const { token } = await createGitHubAppInstallationToken();
  const client = new Octokit({ auth: token, request: { timeout: 15_000 } });
  const repo = RENOVATE_REPOSITORY;

  async function findPullRequest(
    publication: Publication,
  ): Promise<BundlePullRequest | undefined> {
    let number = publication.prNumber;
    if (number === undefined) {
      const { data } = await client.rest.pulls.list({
        ...repo,
        head: `${repo.owner}:${publication.branch}`,
        base: MAIN_BRANCH,
        state: "all",
        per_page: 1,
      });
      number = data[0]?.number;
    }
    if (number === undefined) return undefined;
    const { data } = await client.rest.pulls.get({
      ...repo,
      pull_number: number,
    });
    if (data.head.ref !== publication.branch || data.base.ref !== MAIN_BRANCH) {
      throw new Error(
        `Unexpected GitHub head or base for dependency PR ${String(number)}`,
      );
    }
    return {
      number,
      url: data.html_url,
      headSha: data.head.sha,
      state: data.merged ? "merged" : data.state,
    };
  }

  return {
    token,
    slug: REPO_SLUG,
    findPullRequest,
    async branchHead(branch: string): Promise<string | undefined> {
      try {
        const { data } = await client.rest.git.getRef({
          ...repo,
          ref: `heads/${branch}`,
        });
        return data.object.sha;
      } catch (error: unknown) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async createRecoveredPullRequest(
      publication: Publication,
    ): Promise<RecoveredBundlePullRequest> {
      const { data } = await client.rest.pulls.create({
        ...repo,
        base: MAIN_BRANCH,
        head: publication.branch,
        title: publication.title,
        body: publication.body,
      });
      const created: RecoveredBundlePullRequest = {
        number: data.number,
        url: data.html_url,
        headSha: data.head.sha,
        baseSha: data.base.sha,
        state: "open",
      };
      if (
        data.head.sha === publication.headSha &&
        data.base.sha === publication.baseSha
      )
        return created;
      // Only this successful create proves the App owns a newly opened PR.
      // Reconciliation never closes a PR that it found by reading GitHub.
      try {
        const { data: current } = await client.rest.pulls.get({
          ...repo,
          pull_number: data.number,
        });
        if (
          current.state !== "open" ||
          current.node_id !== data.node_id ||
          current.head.sha !== data.head.sha ||
          current.base.sha !== data.base.sha
        ) {
          created.state = current.merged ? "merged" : current.state;
          return created;
        }
        const { data: closed } = await client.rest.pulls.update({
          ...repo,
          pull_number: data.number,
          state: "closed",
        });
        created.state = closed.state;
        if (closed.state === "closed") created.closedUnverified = true;
      } catch {
        // Preserve the observed mismatch so dispatch can journal its blocked
        // PR even if cleanup readback or closure was unconfirmed.
        return created;
      }
      return created;
    },
    async openWorkPaths(): Promise<Set<string>> {
      const open = await client.paginate(client.rest.pulls.list, {
        ...repo,
        state: "open",
        base: MAIN_BRANCH,
        per_page: 100,
      });
      const files = new Set<string>();
      // Paginate exact paths rather than matching dependency names in PR titles.
      for (const pr of open) {
        const paths = await client.paginate(client.rest.pulls.listFiles, {
          ...repo,
          pull_number: pr.number,
          per_page: 100,
        });
        if (paths.length >= PULL_REQUEST_FILE_LIMIT) {
          const { data } = await client.rest.pulls.get({
            ...repo,
            pull_number: pr.number,
          });
          if (data.changed_files !== paths.length)
            throw new Error(
              `GitHub returned an incomplete changed-path listing for PR ${String(pr.number)}`,
            );
        }
        for (const path of paths) {
          files.add(path.filename);
          if (path.previous_filename !== undefined)
            files.add(path.previous_filename);
        }
      }
      return files;
    },
  };
}

export type RenovateGitHub = Awaited<ReturnType<typeof createRenovateGitHub>>;
