/**
 * A fake GitHub and Woodpecker for the budget simulation. GitHub counts
 * GraphQL points and REST requests, charged (200/404) versus free (304);
 * Woodpecker serves pipelines and an SSE event stream.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { REPOSITORY } from "#lib/ci/github.ts";

export const WOODPECKER = "https://woodpecker.sjer.red";
const HOUR = 60 * 60_000;

export type Counters = {
  graphqlPoints: number;
  restCharged: number;
  restNotModified: number;
  woodpeckerRequests: number;
  events: number;
};

export const sha = (value: string) =>
  createHash("sha1").update(value).digest("hex").slice(0, 40);

/** A reproducible [0, 1) stream: the nth draw hashes the seed and n. */
export function seededRandom(seed: number): () => number {
  let draw = 0;
  return () => {
    const digest = createHash("sha256")
      .update(`${String(seed)}:${String(draw++)}`)
      .digest();
    return digest.readUInt32BE(0) / 2 ** 32;
  };
}

export type Pipeline = {
  number: number;
  commit: string;
  event: "pull_request" | "push";
  ref: string;
  branch: string;
  status: "running" | "success" | "failure" | "killed";
  rerun_count: number;
  endsAt: number;
  fails: boolean;
  finishedAt: number | null;
};

export type Pr = {
  number: number;
  head: string;
  base: string;
  pipelines: Pipeline[];
  statusVersion: number;
  pushAt: number | null;
};

const GraphqlBodySchema = z.object({
  variables: z.object({ number: z.number().optional() }),
});

function summary(pipeline: Pipeline) {
  return {
    number: pipeline.number,
    commit: pipeline.commit,
    status: pipeline.status,
    event: pipeline.event,
    ref: pipeline.ref,
    branch: pipeline.branch,
    rerun_count: pipeline.rerun_count,
    finished:
      pipeline.finishedAt === null ? 0 : Math.floor(pipeline.finishedAt / 1000),
  };
}

function workflows(pipeline: Pipeline) {
  const done = pipeline.status !== "running";
  return [
    { name: "verify", state: pipeline.status },
    { name: "ci-complete", state: done ? pipeline.status : "pending" },
  ];
}

function completion(pipeline: Pipeline): "pending" | "success" | "failure" {
  if (pipeline.status === "running") return "pending";
  return pipeline.status === "success" ? "success" : "failure";
}

export class FakeCi {
  readonly counters: Counters = {
    graphqlPoints: 0,
    restCharged: 0,
    restNotModified: 0,
    woodpeckerRequests: 0,
    events: 0,
  };
  readonly prs = new Map<number, Pr>();
  readonly main: Pipeline[] = [];
  #tip = sha("main-0");
  #pipelineNumber = 10_000;
  #prNumber = 5000;
  readonly #streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  readonly #encoder = new TextEncoder();
  readonly #used = { core: 0, graphql: 0 };
  #windowStart: number;

  constructor(
    readonly random: () => number,
    readonly limit: number,
    readonly mainShare: number,
  ) {
    this.#windowStart = Date.now();
  }

  broadcast(pipeline: Pipeline): void {
    this.counters.events++;
    const frame = this.#encoder.encode(
      `data: ${JSON.stringify({ repo: { id: 1 }, pipeline: summary(pipeline) })}\n\n`,
    );
    for (const controller of this.#streams) controller.enqueue(frame);
  }

  startMain(): void {
    this.#tip = sha(`main-${String(Date.now())}`);
    this.main.unshift({
      number: ++this.#pipelineNumber,
      commit: this.#tip,
      event: "push",
      ref: "refs/heads/main",
      branch: "main",
      status: "running",
      rerun_count: 0,
      endsAt: Date.now() + 25 * 60_000,
      fails: false,
      finishedAt: null,
    });
    this.main.splice(12);
  }

  #newPipeline(pr: Pr): Pipeline {
    return {
      number: ++this.#pipelineNumber,
      commit: pr.head,
      event: "pull_request",
      ref: `refs/pull/${String(pr.number)}/head`,
      branch: `feature-${String(pr.number)}`,
      status: "running",
      rerun_count: 0,
      endsAt: Date.now() + (20 + this.random() * 20) * 60_000,
      fails: this.random() < 0.1,
      finishedAt: null,
    };
  }

  /** A PR with a 20–40 minute pipeline; 10% fail and 10% get a push. */
  openPr(): Pr {
    const number = ++this.#prNumber;
    const pr: Pr = {
      number,
      head: sha(`pr-${String(number)}-0`),
      base: this.#tip,
      pipelines: [],
      statusVersion: 0,
      pushAt:
        this.random() < 0.1
          ? Date.now() + (5 + this.random() * 10) * 60_000
          : null,
    };
    pr.pipelines.unshift(this.#newPipeline(pr));
    this.prs.set(number, pr);
    return pr;
  }

  #limitHeaders(resource: "core" | "graphql"): Record<string, string> {
    if (Date.now() - this.#windowStart >= HOUR) {
      this.#windowStart += HOUR;
      this.#used.core = 0;
      this.#used.graphql = 0;
    }
    const used = this.#used[resource];
    return {
      "x-ratelimit-resource": resource,
      "x-ratelimit-limit": String(this.limit),
      "x-ratelimit-used": String(used),
      "x-ratelimit-remaining": String(Math.max(0, this.limit - used)),
      "x-ratelimit-reset": String(
        Math.floor((this.#windowStart + HOUR) / 1000),
      ),
    };
  }

  #rest(request: Request, body: unknown, status = 200): Response {
    const text = JSON.stringify(body);
    const etag = `"${sha(text)}"`;
    if (status === 200 && request.headers.get("if-none-match") === etag) {
      this.counters.restNotModified++;
      return new Response(null, {
        status: 304,
        headers: { etag, ...this.#limitHeaders("core") },
      });
    }
    this.counters.restCharged++;
    this.#used.core++;
    return new Response(text, {
      status,
      headers: {
        "content-type": "application/json",
        ...(status === 200 ? { etag } : {}),
        ...this.#limitHeaders("core"),
      },
    });
  }

  #pull(pr: Pr) {
    const done = pr.pipelines[0]?.status === "success";
    return {
      number: pr.number,
      html_url: `https://github.com/${REPOSITORY}/pull/${String(pr.number)}`,
      state: "open",
      merged: false,
      merge_commit_sha: null,
      draft: false,
      mergeable: true,
      mergeable_state: done ? "clean" : "blocked",
      head: { sha: pr.head, ref: `feature-${String(pr.number)}` },
      base: { sha: pr.base, ref: "main" },
    };
  }

  #statuses(pr: Pr, commit: string) {
    const pipeline = pr.pipelines.find((item) => item.commit === commit);
    if (pipeline === undefined) return [];
    const url = `${WOODPECKER}/repos/1/pipeline/${String(pipeline.number)}`;
    const complete = completion(pipeline);
    return [
      { context: "ci/merge-conflict", state: "success", target_url: null },
      {
        context: "ci/woodpecker/pr/ci-complete",
        state: complete,
        target_url: `${url}/2`,
      },
      // Woodpecker posts a status per workflow transition; this churns the body.
      {
        context: `ci/woodpecker/pr/workflow-${String(pr.statusVersion % 15)}`,
        state: complete === "pending" ? "pending" : "success",
        target_url: `${url}/${String(pr.statusVersion)}`,
      },
    ];
  }

  #github(request: Request, url: URL): Response {
    // repos/<owner>/<name>/<resource>/...
    const [resource, id, child] = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(3);
    if (resource === "pulls") {
      const pr = this.prs.get(Number(id));
      if (pr === undefined)
        return this.#rest(request, { message: "Not Found" }, 404);
      return this.#rest(request, child === "reviews" ? [] : this.#pull(pr));
    }
    if (resource === "commits") {
      const commit = id ?? "";
      if (child !== "statuses")
        return this.#rest(request, { total_count: 0, check_runs: [] });
      const pr = [...this.prs.values()].find((item) =>
        item.pipelines.some((pipeline) => pipeline.commit === commit),
      );
      return this.#rest(
        request,
        pr === undefined ? [] : this.#statuses(pr, commit),
      );
    }
    if (resource === "rules")
      return this.#rest(request, [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [
              { context: "ci/merge-conflict" },
              { context: "ci/woodpecker/pr/ci-complete" },
            ],
          },
        },
      ]);
    if (resource === "branches" && child === "protection")
      return this.#rest(request, { message: "Branch not protected" }, 404);
    if (resource === "branches")
      return this.#rest(request, { name: "main", commit: { sha: this.#tip } });
    throw new Error(`Unexpected GitHub request ${url.pathname}`);
  }

  async #graphql(request: Request): Promise<Response> {
    this.counters.graphqlPoints++;
    this.#used.graphql++;
    const body = GraphqlBodySchema.parse(await request.json());
    const { number } = body.variables;
    const pr = number === undefined ? undefined : this.prs.get(number);
    const data =
      pr === undefined
        ? {
            rateLimit: {
              limit: this.limit,
              remaining: this.limit - this.#used.graphql,
              used: this.#used.graphql,
              resetAt: new Date(this.#windowStart + HOUR).toISOString(),
            },
          }
        : {
            repository: {
              pullRequest: {
                headRefOid: pr.head,
                baseRefOid: pr.base,
                reviewDecision: null,
              },
            },
          };
    return Response.json({ data }, { headers: this.#limitHeaders("graphql") });
  }

  #stream(signal: AbortSignal | null): Response {
    const streams = this.#streams;
    let own: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        own = controller;
        streams.add(controller);
        signal?.addEventListener(
          "abort",
          () => {
            streams.delete(controller);
            controller.error(signal.reason);
          },
          { once: true },
        );
      },
      cancel() {
        if (own !== null) streams.delete(own);
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  }

  #woodpecker(url: URL, signal: AbortSignal | null): Response {
    this.counters.woodpeckerRequests++;
    if (url.pathname === "/api/stream/events") return this.#stream(signal);
    const single = /\/pipelines\/(\d+)$/u.exec(url.pathname);
    if (single !== null) {
      const number = Number(single[1]);
      const pipeline = [
        ...this.main,
        ...[...this.prs.values()].flatMap((pr) => pr.pipelines),
      ].find((item) => item.number === number);
      if (pipeline === undefined)
        throw new Error(`No pipeline ${String(number)}`);
      return Response.json({
        ...summary(pipeline),
        workflows: workflows(pipeline),
      });
    }
    const events = new Set((url.searchParams.get("event") ?? "").split(","));
    const ref = url.searchParams.get("ref");
    if (url.searchParams.get("page") !== "1") return Response.json([]);
    if (ref === null)
      return Response.json(
        this.main
          .filter((item) => events.has(item.event))
          .map((item) => summary(item)),
      );
    const pr = this.prs.get(Number(/refs\/pull\/(\d+)\//u.exec(ref)?.[1]));
    return Response.json(
      pr !== undefined && events.has("pull_request")
        ? pr.pipelines.map((item) => summary(item))
        : [],
    );
  }

  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request =
      input instanceof Request ? input : new Request(String(input), init ?? {});
    const url = new URL(request.url);
    if (url.origin === WOODPECKER)
      return this.#woodpecker(url, init?.signal ?? null);
    return url.pathname === "/graphql"
      ? this.#graphql(request)
      : this.#github(request, url);
  };

  #settlePrs(now: number): void {
    for (const pr of this.prs.values()) {
      const current = pr.pipelines[0];
      if (current?.status !== "running") continue;
      if (pr.pushAt !== null && now >= pr.pushAt) {
        pr.pushAt = null;
        current.status = "killed";
        current.finishedAt = now;
        this.broadcast(current);
        pr.head = sha(`pr-${String(pr.number)}-${String(now)}`);
        const next = this.#newPipeline(pr);
        pr.pipelines.unshift(next);
        this.broadcast(next);
      } else if (now >= current.endsAt) {
        current.status = current.fails ? "failure" : "success";
        current.finishedAt = now;
        pr.statusVersion++;
        this.broadcast(current);
      }
    }
  }

  /** Finish due pipelines, then emit one event of the configured mix. */
  readonly tick = (): void => {
    const now = Date.now();
    for (const pipeline of this.main)
      if (pipeline.status === "running" && now >= pipeline.endsAt) {
        pipeline.status = "success";
        pipeline.finishedAt = now;
        this.broadcast(pipeline);
      }
    this.#settlePrs(now);
    if (this.random() < this.mainShare) {
      const running = this.main.find((item) => item.status === "running");
      if (running !== undefined) this.broadcast(running);
      return;
    }
    const running = [...this.prs.values()].filter(
      (pr) => pr.pipelines[0]?.status === "running",
    );
    const pick = running[Math.floor(this.random() * running.length)];
    const pipeline = pick?.pipelines[0];
    if (pick === undefined || pipeline === undefined) return;
    if (this.random() < 0.6) pick.statusVersion++;
    this.broadcast(pipeline);
  };
}
