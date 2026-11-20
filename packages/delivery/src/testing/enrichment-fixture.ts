import type { Database } from "#infrastructure/database.ts";
import { createEnrichment } from "#infrastructure/enrichment/enrichment.ts";

const SECONDS = 1_790_000_000;

/**
 * The shape of a pipeline's run. `service` is the four workflows most
 * fixtures need. `monorepo` is every CI lane a push to main runs, all passed,
 * as production reports for each service's build. `monorepo-running` is that
 * run in progress with one workflow failed and others still running.
 */
export type FixtureRun = "service" | "monorepo" | "monorepo-running";
/** The run each pipeline number reports; a number left out is a `service` run. */
export type FixtureRuns = Record<number, FixtureRun>;

/** Every workflow of a monorepo run that is not a test, in pid order. */
export const MONOREPO_BUILD_WORKFLOWS = [
  "alert-dashboard-sqlite",
  "ci-images-register",
  "cooklang-rich-preview",
  "delivery-publish",
  "helm-push",
  "images",
  "package-publish",
  "release-please",
  "resume-build",
  "resume-publish",
  "scout-site-archives",
  "site-archives",
  "sites",
  "tofu-archives",
];
export const MONOREPO_TEST_WORKFLOWS = [
  "verify",
  "playwright-e2e",
  "docker-e2e",
  "semgrep",
];
/** The workflow whose tracing service container Woodpecker stops when it ends. */
const SERVICE_WORKFLOW = "docker-e2e";
/** What the in-progress run has not finished: the rest passed. */
const IN_PROGRESS: Record<string, string> = {
  "helm-push": "failure",
  images: "running",
  "playwright-e2e": "running",
  "docker-e2e": "pending",
};

function workflow(
  pid: number,
  name: string,
  state = "success",
  start = SECONDS,
) {
  const times = {
    started: state === "pending" ? 0 : start + pid,
    finished: state === "success" || state === "failure" ? start + pid * 60 : 0,
  };
  const step = (offset: number, stepName: string, type = "commands") => ({
    pid: pid * 10 + offset,
    name: stepName,
    state,
    exit_code: state === "failure" ? 1 : 0,
    ...times,
    type,
  });
  return {
    pid,
    name,
    state,
    ...times,
    children:
      name === SERVICE_WORKFLOW
        ? [
            // Stopped with the workflow: failed with 137 although it passed.
            {
              ...step(0, "tempo", "service"),
              ...(state === "success"
                ? { state: "failure", exit_code: 137 }
                : {}),
            },
            step(1, `${name}-step`),
          ]
        : [step(0, `${name}-step`)],
  };
}

function workflows(run: FixtureRun, start: number) {
  if (run === "service")
    return [
      workflow(1, "verify"),
      workflow(2, "images"),
      workflow(3, "playwright-e2e"),
      workflow(4, "delivery-publish"),
    ];
  return [...MONOREPO_BUILD_WORKFLOWS, ...MONOREPO_TEST_WORKFLOWS].map(
    (name, index) =>
      workflow(
        index + 1,
        name,
        run === "monorepo-running" ? IN_PROGRESS[name] : undefined,
        start,
      ),
  );
}

function pipeline(number: number, sha: string, run: FixtureRun) {
  const running = run === "monorepo-running";
  // A run in progress began twenty minutes ago, so its durations stay small.
  const start = running ? Math.floor(Date.now() / 1000) - 1200 : SECONDS;
  return {
    number,
    status: running ? "running" : "success",
    commit: sha,
    message: "feat(arcade): ship the isolated fixture",
    created: start,
    started: start,
    finished: running ? 0 : start + 900,
    event: "push",
    branch: "main",
    author: "shepherdjerred",
    forge_url: `https://github.com/shepherdjerred/monorepo/commit/${sha}`,
    workflows: workflows(run, start),
  };
}

function commit(sha: string) {
  return {
    data: {
      repository: {
        object: {
          oid: sha,
          messageHeadline: "feat(arcade): ship the isolated fixture",
          messageBody: "Why\n\nAcceptance coverage.",
          committedDate: "2026-09-21T14:00:00Z",
          url: `https://github.com/shepherdjerred/monorepo/commit/${sha}`,
          author: { name: "Fixture Author", user: { login: "fixture" } },
          associatedPullRequests: {
            nodes: [
              {
                number: 4242,
                title: "feat(arcade): ship the isolated fixture",
                url: "https://github.com/shepherdjerred/monorepo/pull/4242",
                mergedAt: "2026-09-21T14:05:00Z",
                author: { login: "fixture" },
              },
            ],
          },
        },
      },
    },
  };
}

/** The images each ArgoCD Application double reports running, by Application name. */
export type FixtureLiveImages = Record<string, string[]>;

/** Upstream doubles for Woodpecker, GitHub and ArgoCD; never reach the network. */
export function fixtureUpstreams(
  request: string | URL,
  liveImages: FixtureLiveImages = {},
  runs: FixtureRuns = {},
) {
  const url = new URL(String(request));
  const pipelineMatch = /^\/api\/repos\/1\/pipelines\/(\d+)$/.exec(
    url.pathname,
  );
  if (
    url.hostname === "woodpecker.sjer.red" &&
    pipelineMatch?.[1] !== undefined
  ) {
    const number = Number(pipelineMatch[1]);
    return Promise.resolve(
      Response.json(
        pipeline(number, "a".repeat(40), runs[number] ?? "service"),
      ),
    );
  }
  if (url.hostname === "api.github.com")
    return Promise.resolve(Response.json(commit("a".repeat(40))));
  const application = /^\/api\/v1\/applications\/([^/]+)$/u.exec(
    url.pathname,
  )?.[1];
  if (application !== undefined && url.hostname === "argocd.sjer.red")
    return Promise.resolve(
      Response.json({
        status: {
          sync: { status: "Synced", revision: "0.0.0-fixture" },
          health: { status: "Healthy" },
          reconciledAt: "2026-09-21T14:10:00Z",
          operationState: {
            phase: "Succeeded",
            message: "successfully synced",
            finishedAt: "2026-09-21T14:09:00Z",
          },
          summary: {
            images: liveImages[decodeURIComponent(application)] ?? [],
          },
        },
      }),
    );
  return Promise.resolve(new Response("not found", { status: 404 }));
}

export function fixtureEnrichment(
  database: Database,
  liveImages: FixtureLiveImages = {},
  runs: FixtureRuns = {},
) {
  return createEnrichment({
    database,
    enabledSources: () => Promise.resolve(["woodpecker", "github", "argocd"]),
    woodpecker: {
      origin: "https://woodpecker.sjer.red",
      repositoryId: 1,
      token: "fixture-woodpecker",
    },
    github: { owner: "shepherdjerred", name: "monorepo", token: "fixture-gh" },
    argocd: { origin: "https://argocd.sjer.red", token: "fixture-argo" },
    fetch: (request) => fixtureUpstreams(request, liveImages, runs),
  });
}
