import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

const BUILD_STATES = [
  "running",
  "scheduled",
  "passed",
  "failing",
  "failed",
  "blocked",
  "canceled",
  "canceling",
  "skipped",
  "not_run",
  "creating",
  "waiting",
  "waiting_failed",
] as const;

const BuildSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(BUILD_STATES),
  web_url: z.url(),
  commit: z.string(),
  message: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export type BuildkiteBuildState = (typeof BUILD_STATES)[number];

export type BuildkiteBuild = {
  number: number;
  state: BuildkiteBuildState;
  url: string;
  commit: string;
  message: string;
  createdAt: string;
  finishedAt: string | undefined;
};

/** Terminal states that say whether `main` is green. */
export const VERDICT_STATES: ReadonlySet<BuildkiteBuildState> = new Set([
  "passed",
  "failed",
]);

export type BranchStatus = {
  /** Newest build, whatever its state. */
  latest: BuildkiteBuild | undefined;
  /** Newest build that passed or failed. */
  verdict: BuildkiteBuild | undefined;
};

/** Read-only Buildkite REST client scoped to one pipeline. */
export class BuildkiteClient {
  readonly #token: string;
  readonly #organization: string;
  readonly #pipeline: string;
  readonly #fetch: Fetch;

  constructor(options: {
    token: string;
    organization: string;
    pipeline: string;
    fetch?: Fetch;
  }) {
    this.#token = options.token;
    this.#organization = options.organization;
    this.#pipeline = options.pipeline;
    this.#fetch = options.fetch ?? fetch;
  }

  async recentBuilds(branch: string, count: number): Promise<BuildkiteBuild[]> {
    const url = new URL(
      `https://api.buildkite.com/v2/organizations/${encodeURIComponent(this.#organization)}/pipelines/${encodeURIComponent(this.#pipeline)}/builds`,
    );
    url.searchParams.set("branch", branch);
    url.searchParams.set("per_page", String(count));
    url.searchParams.set("exclude_jobs", "true");
    const builds = await fetchJson(
      this.#fetch,
      {
        upstream: "buildkite",
        url,
        init: {
          headers: { accept: "application/json", ...bearer(this.#token) },
        },
      },
      z.array(BuildSchema),
    );
    return builds.map((build) => ({
      number: build.number,
      state: build.state,
      url: build.web_url,
      commit: build.commit,
      message: (build.message ?? "").split("\n")[0] ?? "",
      createdAt: build.created_at,
      finishedAt: build.finished_at ?? undefined,
    }));
  }

  /** The newest build and the newest pass/fail verdict on a branch. */
  async branchStatus(branch: string): Promise<BranchStatus> {
    const builds = await this.recentBuilds(branch, 20);
    const sorted = builds.toSorted((left, right) => right.number - left.number);
    return {
      latest: sorted[0],
      verdict: sorted.find((build) => VERDICT_STATES.has(build.state)),
    };
  }
}
