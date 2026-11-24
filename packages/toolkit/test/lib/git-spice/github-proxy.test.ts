import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  finalizeGitHubProxyOutcome,
  shouldStartGitHubProxy,
  startGitHubProxy,
  withGitHubProxy,
} from "#lib/git-spice/github-proxy.ts";
import { runGitSpice } from "#lib/git-spice/run.ts";
import {
  findBranchesByPrGqlIds,
  readSpiceBranches,
} from "#lib/git-spice/spice-state.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGitSync(args: readonly string[], cwd: string): void {
  const res = Bun.spawnSync(["git", ...args], { cwd, env: Bun.env });
  if (res.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(res.exitCode)}): ${res.stderr.toString()}`,
    );
  }
}

function inputToUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function decodeBodyText(body: RequestInit["body"]): string {
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  return typeof body === "string" ? body : "";
}

const GraphqlIdsBodySchema = z.looseObject({
  query: z.string(),
  variables: z
    .looseObject({
      ids: z.array(z.string()).optional(),
    })
    .optional(),
});

describe("github-proxy routing and batching", () => {
  test("forwards /v3/* and POST /graphql while preserving Authorization", async () => {
    const received: {
      url: string;
      method: string;
      auth: string | null;
      body: string;
    }[] = [];

    const proxy = startGitHubProxy({
      upstreamBaseUrl: "https://upstream.example",
      retryDelaysMs: [1, 1],
      fetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        received.push({
          url: inputToUrlString(input),
          method: init?.method ?? "GET",
          auth: headers.get("authorization"),
          body: decodeBodyText(init?.body),
        });
        return Response.json(
          { ok: true },
          { headers: { "content-encoding": "gzip" } },
        );
      },
    });

    try {
      const restRes = await fetch(
        `${proxy.url}/v3/repos/owner/repo/pulls/42?state=open`,
        { headers: { Authorization: "Bearer synthetic-token" } },
      );
      expect(restRes.status).toBe(200);
      expect(restRes.headers.get("content-encoding")).toBeNull();
      expect(await restRes.json()).toEqual({ ok: true });

      const gqlRes = await fetch(`${proxy.url}/graphql`, {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "query { viewer { login } }" }),
      });
      expect(gqlRes.status).toBe(200);

      expect(received).toEqual([
        {
          url: "https://upstream.example/repos/owner/repo/pulls/42?state=open",
          method: "GET",
          auth: "Bearer synthetic-token",
          body: "",
        },
        {
          url: "https://upstream.example/graphql",
          method: "POST",
          auth: "Bearer synthetic-token",
          body: JSON.stringify({ query: "query { viewer { login } }" }),
        },
      ]);
    } finally {
      await proxy.stop();
    }
  });

  test("chunks nodes(ids:) > 100 into batches of 100 in exact order and fails repo sync on chunk error (AI-12)", async () => {
    const seenBatchSizes: number[] = [];
    const totalIds = 245;
    const allIds = Array.from(
      { length: totalIds },
      (_, idx) => `PR_node_${String(idx)}`,
    );

    const proxy = startGitHubProxy({
      upstreamBaseUrl: "https://upstream.example",
      retryDelaysMs: [1, 1],
      fetchImpl: async (_input, init) => {
        const parsed = GraphqlIdsBodySchema.parse(
          JSON.parse(decodeBodyText(init?.body)),
        );
        const chunkIds = parsed.variables?.ids ?? [];
        seenBatchSizes.push(chunkIds.length);
        return Response.json({
          data: {
            nodes: chunkIds.map((id) => ({
              id,
              state: "OPEN",
              headRefOid: `oid-${id}`,
            })),
          },
        });
      },
    });

    try {
      const response = await fetch(`${proxy.url}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "query($ids:[ID!]!){nodes(ids: $ids){... on PullRequest{id,state,headRefOid}}}",
          variables: { ids: allIds },
        }),
      });
      expect(response.status).toBe(200);
      expect(seenBatchSizes).toEqual([100, 100, 45]);
      const payload = z
        .object({
          data: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                state: z.string(),
                headRefOid: z.string(),
              }),
            ),
          }),
        })
        .parse(await response.json());
      expect(payload.data.nodes).toHaveLength(totalIds);
      expect(payload.data.nodes.map((node) => node.id)).toEqual(allIds);
      expect(proxy.state.batchFailed).toBe(false);
    } finally {
      await proxy.stop();
    }

    let callCount = 0;
    const failingProxy = startGitHubProxy({
      upstreamBaseUrl: "https://upstream.example",
      retryDelaysMs: [1, 1],
      fetchImpl: async (_input, init) => {
        callCount += 1;
        const parsed = GraphqlIdsBodySchema.parse(
          JSON.parse(decodeBodyText(init?.body)),
        );
        if (callCount > 1) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return Response.json({
          data: {
            nodes: (parsed.variables?.ids ?? []).map(() => ({
              state: "OPEN",
              headRefOid: "abc",
            })),
          },
        });
      },
    });

    try {
      const res = await fetch(`${failingProxy.url}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{state,headRefOid}}}",
          variables: { ids: allIds },
        }),
      });
      expect(res.status).toBe(500);
      expect(failingProxy.state.batchFailed).toBe(true);

      const exit = await finalizeGitHubProxyOutcome({
        args: ["rs"],
        cwd: process.cwd(),
        env: {},
        exitCode: 0,
        state: failingProxy.state,
      });
      expect(exit).toBe(1);
    } finally {
      await failingProxy.stop();
    }
  });
});

async function seedRepoWithMissingAndMergedPrs(root: string): Promise<{
  repo: string;
  mainSha: string;
  featMergedSha: string;
}> {
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  runGitSync(["init", "--bare", "-b", "main", remote], root);
  runGitSync(["clone", remote, repo], root);
  runGitSync(["config", "user.name", "Test"], repo);
  runGitSync(["config", "user.email", "test@example.com"], repo);
  runGitSync(
    [
      "remote",
      "set-url",
      "origin",
      "https://github.com/shepherdjerred/monorepo.git",
    ],
    repo,
  );
  runGitSync(
    [
      "config",
      `url.${remote}.insteadOf`,
      "https://github.com/shepherdjerred/monorepo.git",
    ],
    repo,
  );
  await Bun.write(path.join(repo, "file.txt"), "init\n");
  runGitSync(["add", "file.txt"], repo);
  runGitSync(["commit", "-m", "init"], repo);
  runGitSync(["push", "-u", "origin", "main"], repo);

  const initExit = Bun.spawnSync(
    [
      "git-spice",
      "--no-prompt",
      "repo",
      "init",
      "--trunk",
      "main",
      "--remote",
      "origin",
    ],
    { cwd: repo, env: Bun.env },
  );
  expect(initExit.exitCode).toBe(0);

  Bun.spawnSync(
    [
      "git-spice",
      "--no-prompt",
      "branch",
      "create",
      "stale/missing-pr",
      "-m",
      "stale",
    ],
    { cwd: repo, env: Bun.env },
  );
  Bun.spawnSync(
    [
      "git-spice",
      "--no-prompt",
      "branch",
      "create",
      "feat/merged-pr",
      "--target",
      "main",
      "-m",
      "merged",
    ],
    { cwd: repo, env: Bun.env },
  );
  const featMergedSha = Bun.spawnSync(["git", "rev-parse", "feat/merged-pr"], {
    cwd: repo,
    env: Bun.env,
  })
    .stdout.toString()
    .trim();
  runGitSync(["checkout", "main"], repo);

  const mainSha = Bun.spawnSync(["git", "rev-parse", "main"], {
    cwd: repo,
    env: Bun.env,
  })
    .stdout.toString()
    .trim();
  const spiceWork = path.join(root, "spice-work");
  runGitSync(["clone", repo, spiceWork], root);
  runGitSync(
    ["fetch", "origin", "refs/spice/data:refs/heads/spice-edit"],
    spiceWork,
  );
  runGitSync(["checkout", "spice-edit"], spiceWork);
  runGitSync(["config", "user.name", "Test"], spiceWork);
  runGitSync(["config", "user.email", "test@example.com"], spiceWork);

  await Bun.write(
    path.join(spiceWork, "branches/stale/missing-pr"),
    JSON.stringify({
      base: { name: "main", hash: mainSha },
      change: { github: { pr: { number: 3351, gqlID: "PR_missing_3351" } } },
    }),
  );
  await Bun.write(
    path.join(spiceWork, "branches/feat/merged-pr"),
    JSON.stringify({
      base: { name: "main", hash: mainSha },
      change: { github: { pr: { number: 3352, gqlID: "PR_merged_3352" } } },
    }),
  );
  const refLines: string[] = [];
  for (let i = 0; i < 105; i += 1) {
    const name = `extra-${String(i)}`;
    refLines.push(`create refs/heads/${name} ${mainSha}`);
    await Bun.write(
      path.join(spiceWork, `branches/${name}`),
      JSON.stringify({
        base: { name: "main", hash: mainSha },
        change: {
          github: { pr: { number: 4000 + i, gqlID: `PR_extra_${String(i)}` } },
        },
      }),
    );
  }
  const updateRes = Bun.spawnSync(["git", "update-ref", "--stdin"], {
    cwd: repo,
    env: Bun.env,
    stdin: new TextEncoder().encode(`${refLines.join("\n")}\n`),
  });
  expect(updateRes.exitCode).toBe(0);
  runGitSync(["add", "."], spiceWork);
  runGitSync(["commit", "-m", "seed spice metadata"], spiceWork);
  runGitSync(["push", repo, "spice-edit:refs/spice/data"], spiceWork);
  return { repo, mainSha, featMergedSha };
}

describe("github-proxy NOT_FOUND, retries, and configuration", () => {
  test("rewrites NOT_FOUND nodes, reports branch + PR warning from refs/spice/data, exits 1 on repo sync and 0 on merge (AI-103)", async () => {
    const root = await makeTempDir("toolkit-spice-ai103-");
    const { repo, mainSha, featMergedSha } =
      await seedRepoWithMissingAndMergedPrs(root);

    const spiceMap = await readSpiceBranches(repo, Bun.env);
    expect(spiceMap.get("stale/missing-pr")?.prNumber).toBe(3351);
    const matched = await findBranchesByPrGqlIds(
      repo,
      ["PR_missing_3351"],
      Bun.env,
    );
    expect(matched).toEqual([
      { gqlId: "PR_missing_3351", branch: "stale/missing-pr", prNumber: 3351 },
    ]);

    const seenBatches: number[] = [];
    const warnings: string[] = [];
    const syncExit = await runGitSpice(
      ["repo", "sync"],
      { ...Bun.env, GH_TOKEN: "synthetic-token" },
      {
        cwd: repo,
        stdin: "ignore",
        writeStderr: (line) => warnings.push(line),
        proxyOptions: {
          upstreamBaseUrl: "https://upstream.example",
          retryDelaysMs: [1, 1],
          fetchImpl: async (_input, init) => {
            const payload = GraphqlIdsBodySchema.parse(
              JSON.parse(decodeBodyText(init?.body)),
            );
            const ids = payload.variables?.ids;
            if (Array.isArray(ids)) {
              seenBatches.push(ids.length);
              const errors: unknown[] = [];
              const nodes = ids.map((id, idx) => {
                if (id === "PR_missing_3351") {
                  errors.push({
                    type: "NOT_FOUND",
                    path: ["nodes", idx],
                    message: `Could not resolve to a node with the global id of '${id}'.`,
                  });
                  return null;
                }
                return id === "PR_merged_3352"
                  ? { state: "MERGED", headRefOid: featMergedSha }
                  : { state: "OPEN", headRefOid: mainSha };
              });
              return Response.json({
                data: { nodes },
                ...(errors.length > 0 ? { errors } : {}),
              });
            }
            return Response.json({ data: { repository: { id: "R_1" } } });
          },
        },
      },
    );

    expect(seenBatches).toEqual([100, 7]);
    expect(syncExit).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PR #3351");
    expect(warnings[0]).toContain("stale/missing-pr");
    expect(warnings[0]).toContain(
      "toolkit spice branch untrack stale/missing-pr",
    );

    const afterBranches = await readSpiceBranches(repo, Bun.env);
    expect(afterBranches.has("stale/missing-pr")).toBe(true);
    expect(afterBranches.has("feat/merged-pr")).toBe(false);

    const mergeWarnings: string[] = [];
    const mergeExit = await finalizeGitHubProxyOutcome({
      args: ["branch", "merge"],
      cwd: repo,
      env: Bun.env,
      exitCode: 0,
      state: {
        batchFailed: false,
        missingGqlIds: new Set(["PR_missing_3351"]),
      },
      writeStderr: (line) => mergeWarnings.push(line),
    });
    expect(mergeExit).toBe(0);
    expect(mergeWarnings[0]).toContain("stale/missing-pr");
  }, 25_000);

  test("retries transient failures only for read-only REST and GraphQL queries, never mutations or REST writes (AI-155)", async () => {
    const delays: number[] = [];
    let queryAttempts = 0;
    let getAttempts = 0;
    let mutationAttempts = 0;
    let putAttempts = 0;

    const proxy = startGitHubProxy({
      upstreamBaseUrl: "https://upstream.example",
      retryDelaysMs: [300, 1000],
      sleepImpl: async (ms) => {
        delays.push(ms);
      },
      fetchImpl: async (input, init) => {
        const url = new URL(inputToUrlString(input));
        const method = init?.method ?? "GET";
        if (url.pathname === "/graphql") {
          const parsed = GraphqlIdsBodySchema.parse(
            JSON.parse(decodeBodyText(init?.body)),
          );
          if (parsed.query.includes("mutation")) {
            mutationAttempts += 1;
            throw Object.assign(new Error("read ECONNRESET"), {
              code: "ECONNRESET",
            });
          }
          queryAttempts += 1;
          if (queryAttempts === 1) {
            throw new Error("read: connection reset by peer");
          }
          return queryAttempts === 2
            ? new Response("Bad Gateway", { status: 502 })
            : Response.json({ data: { viewer: { login: "octocat" } } });
        }

        if (method === "GET") {
          getAttempts += 1;
          if (getAttempts === 1) {
            throw new Error("The socket connection was closed unexpectedly");
          }
          return getAttempts === 2
            ? new Response("Service Unavailable", { status: 503 })
            : Response.json({ merged: true });
        }

        putAttempts += 1;
        return new Response("Gateway Timeout", { status: 504 });
      },
    });

    try {
      const gqlQueryRes = await fetch(`${proxy.url}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "# leading comment\n  { viewer { login } }",
        }),
      });
      expect(gqlQueryRes.status).toBe(200);
      expect(queryAttempts).toBe(3);

      const getRes = await fetch(`${proxy.url}/v3/repos/o/r/pulls/1`);
      expect(getRes.status).toBe(200);
      expect(getAttempts).toBe(3);

      const mutationRes = await fetch(`${proxy.url}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "mutation($input:MergePullRequestInput!){mergePullRequest(input:$input){pullRequest{id}}}",
        }),
      });
      expect(mutationRes.status).toBe(502);
      expect(mutationAttempts).toBe(1);

      const putRes = await fetch(`${proxy.url}/v3/repos/o/r/pulls/1/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" }),
      });
      expect(putRes.status).toBe(504);
      expect(putAttempts).toBe(1);

      expect(delays).toEqual([300, 1000, 300, 1000]);
    } finally {
      await proxy.stop();
    }
  });

  test("honors explicit GITHUB_API_URL, --github-api-url, and spice.forge.github.apiUrl", async () => {
    const dir = await makeTempDir("toolkit-spice-cfg-");
    runGitSync(["init", "-b", "main"], dir);

    expect(await shouldStartGitHubProxy(["rs"], dir, {})).toBe(true);
    expect(
      await shouldStartGitHubProxy(["rs"], dir, {
        GITHUB_API_URL: "https://ghe.example/api/v3",
      }),
    ).toBe(false);
    expect(
      await shouldStartGitHubProxy(
        ["--github-api-url=https://ghe.example/api/v3", "rs"],
        dir,
        {},
      ),
    ).toBe(false);

    runGitSync(
      ["config", "spice.forge.github.apiUrl", "https://ghe.example/api/v3"],
      dir,
    );
    expect(await shouldStartGitHubProxy(["rs"], dir, {})).toBe(false);

    let receivedEnv: Record<string, string | undefined> = {};
    await withGitHubProxy({ args: ["rs"], cwd: dir, env: {} }, async (env) => {
      receivedEnv = env;
      return 0;
    });
    expect(receivedEnv["GITHUB_API_URL"]).toBeUndefined();
  });
});
