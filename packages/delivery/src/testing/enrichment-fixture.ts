import type { Database } from "#infrastructure/database.ts";
import { createEnrichment } from "#infrastructure/enrichment/enrichment.ts";

const SECONDS = 1_790_000_000;

function pipeline(number: number, sha: string) {
  const workflow = (pid: number, name: string, state = "success") => ({
    pid,
    name,
    state,
    started: SECONDS + pid,
    finished: SECONDS + pid * 60,
    children: [
      {
        pid: pid * 10,
        name: `${name}-step`,
        state,
        exit_code: state === "success" ? 0 : 1,
        started: SECONDS + pid,
        finished: SECONDS + pid * 60,
        type: "commands",
      },
    ],
  });
  return {
    number,
    status: "success",
    commit: sha,
    message: "feat(arcade): ship the isolated fixture",
    created: SECONDS,
    started: SECONDS,
    finished: SECONDS + 900,
    event: "push",
    branch: "main",
    author: "shepherdjerred",
    forge_url: `https://github.com/shepherdjerred/monorepo/commit/${sha}`,
    workflows: [
      workflow(1, "verify"),
      workflow(2, "images"),
      workflow(3, "playwright-e2e"),
      workflow(4, "delivery-publish"),
    ],
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

/** Upstream doubles for Woodpecker, GitHub and ArgoCD; never reach the network. */
export function fixtureUpstreams(request: string | URL) {
  const url = new URL(String(request));
  const pipelineMatch = /^\/api\/repos\/1\/pipelines\/(\d+)$/.exec(
    url.pathname,
  );
  if (
    url.hostname === "woodpecker.sjer.red" &&
    pipelineMatch?.[1] !== undefined
  )
    return Promise.resolve(
      Response.json(pipeline(Number(pipelineMatch[1]), "a".repeat(40))),
    );
  if (url.hostname === "api.github.com")
    return Promise.resolve(Response.json(commit("a".repeat(40))));
  if (url.hostname === "argocd.sjer.red")
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
          summary: { images: [] },
        },
      }),
    );
  return Promise.resolve(new Response("not found", { status: 404 }));
}

export function fixtureEnrichment(database: Database) {
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
    fetch: fixtureUpstreams,
  });
}
