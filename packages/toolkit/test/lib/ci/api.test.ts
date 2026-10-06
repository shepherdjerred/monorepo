import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import {
  getWoodpeckerPipelineForCommit,
  woodpeckerConfigFromEnv,
  loadWoodpeckerConfig,
  getPipeline,
} from "#lib/woodpecker/ci.ts";
import { logExcerpt, pipelineDiagnostics } from "#lib/ci/diagnostics.ts";
import { ciFixture, CI_HEAD } from "./fixtures.ts";

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "private-test-token",
  repoId: 1,
};
const json = (value: unknown) => Response.json(value);
const encode = (value: string, line: number) => ({
  data: Buffer.from(value).toString("base64"),
  line,
  type: 1,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("Woodpecker paginates and verifies PR identity, ignoring same-SHA push builds", async () => {
  const summary = {
    number: 7,
    commit: CI_HEAD,
    status: "success",
    event: "pull_request",
    ref: "refs/pull/99/head",
    branch: "feature",
  };
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith("/pipelines/7"))
        return json({ ...summary, workflows: [] });
      if (url.searchParams.get("page") === "1")
        return json(
          Array.from({ length: 50 }, (_, index) => ({
            ...summary,
            number: 100 + index,
            event: "push",
            ref: "refs/heads/main",
          })),
        );
      return json([summary]);
    }),
  );
  const pipeline = await getWoodpeckerPipelineForCommit(CI_HEAD, config, 99);
  expect(pipeline?.number).toBe(7);
  expect(requests).toHaveLength(3);
  expect(requests[0]?.searchParams.get("event")).toBe("pull_request");
  expect(requests[0]?.searchParams.get("ref")).toBe("refs/pull/99/");
});

test("a pipeline detail response for another head is a contract error", async () => {
  const summary = {
    number: 7,
    commit: CI_HEAD,
    status: "success",
    event: "pull_request",
    ref: "refs/pull/99/head",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      json(
        url.pathname.endsWith("/7")
          ? { ...summary, commit: "wrong", workflows: [] }
          : [summary],
      ),
    ),
  );
  await expect(
    getWoodpeckerPipelineForCommit(CI_HEAD, config, 99),
  ).rejects.toThrow("does not match");
});

test("Woodpecker's null error list preserves failed workflow diagnostics", async () => {
  const pipeline = {
    number: 7,
    commit: CI_HEAD,
    status: "failure",
    errors: null,
    workflows: [
      {
        name: "images",
        state: "failure",
        children: [
          { id: 10, pid: 47, name: "images", state: "failure", exit_code: 1 },
        ],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      json(
        url.pathname.includes("/logs/")
          ? [encode("Missing required smoke bootstrap credential", 1)]
          : pipeline,
      ),
    ),
  );
  const actual = await getPipeline(pipeline.number, config);
  expect(actual.number).toBe(pipeline.number);
  expect(actual.workflows).toEqual(pipeline.workflows);
  expect(actual.errors).toBeNull();
  const diagnostics = await pipelineDiagnostics(actual, config);
  expect(diagnostics[0]?.workflow).toBe("images");
  expect(diagnostics[0]?.logs).toContain(
    "Missing required smoke bootstrap credential",
  );
});

test("malformed and unauthenticated Woodpecker responses fail explicitly", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 401 })),
  );
  await expect(
    getWoodpeckerPipelineForCommit(CI_HEAD, config, 99),
  ).rejects.toThrow("401");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json([{ number: 7, commit: CI_HEAD, status: "success" }]),
    ),
  );
  await expect(
    getWoodpeckerPipelineForCommit(CI_HEAD, config, 99),
  ).rejects.toThrow();
  expect(() => woodpeckerConfigFromEnv({ WOODPECKER_TOKEN: "" })).toThrow(
    "required",
  );
  vi.stubEnv("WOODPECKER_TOKEN", undefined);
  vi.stubEnv("WOODPECKER_URL", "https://custom.example");
  await expect(loadWoodpeckerConfig()).rejects.toThrow(
    "require WOODPECKER_TOKEN",
  );
});

test("GitHub combines effective rules with classic protection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      json(
        url.pathname.endsWith("/protection")
          ? {
              required_status_checks: {
                strict: true,
                checks: [{ context: "classic", app_id: -1 }],
              },
              required_pull_request_reviews: {
                required_approving_review_count: 2,
              },
            }
          : [
              {
                type: "required_status_checks",
                parameters: {
                  strict_required_status_checks_policy: false,
                  required_status_checks: [
                    { context: "ruleset", integration_id: 42 },
                  ],
                },
              },
            ],
      ),
    ),
  );
  const rules = await new GitHubClient("test").rules("main");
  expect(rules).toEqual({
    strict: true,
    approvals: 2,
    checks: [
      { name: "ruleset", appId: 42 },
      { name: "classic", appId: null },
    ],
  });
});

test("missing required-rule parameters never silently erase merge requirements", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      url.pathname.endsWith("/protection")
        ? new Response("", { status: 404 })
        : Response.json([{ type: "required_status_checks" }]),
    ),
  );
  await expect(new GitHubClient("test").rules("main")).rejects.toThrow();
});

test("GitHub status pagination keeps newest context and selects exact-head check runs", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      requests.push(url.toString());
      if (url.pathname.endsWith("/check-runs"))
        return json({
          check_runs: [
            {
              name: "tests",
              head_sha: CI_HEAD,
              status: "completed",
              conclusion: "action_required",
              html_url: null,
              app: { id: 42 },
            },
            {
              name: "tests",
              head_sha: "wrong",
              status: "completed",
              conclusion: "success",
              html_url: null,
              app: { id: 42 },
            },
          ],
        });
      if (url.searchParams.get("page") === "1")
        return json(
          Array.from({ length: 100 }, () => ({
            context: "lint",
            state: "pending",
            target_url: null,
          })),
        );
      return json([
        { context: "lint", state: "success", target_url: null },
        { context: "other", state: "error", target_url: null },
      ]);
    }),
  );
  expect(await new GitHubClient("test").checks(CI_HEAD)).toEqual([
    { name: "lint", state: "pending", url: null, appId: null },
    { name: "other", state: "fail", url: null, appId: null },
    { name: "tests", state: "human_action", url: null, appId: 42 },
  ]);
  expect(requests).toHaveLength(3);
});

test("log excerpts sort and decode records, redact before bounding, and accept null markers", () => {
  const excerpt = logExcerpt(
    [
      encode("tail", 3),
      encode(`token=${config.token}\n\u{1B}[31mfailed\u{1B}[0m`, 1),
      { data: null, line: 2, type: 1 },
    ],
    [config.token],
  );
  expect(excerpt.logs).toContain("failed");
  expect(excerpt.logs).not.toContain(config.token);
  expect(excerpt.logs).not.toContain("\u{1B}");
  expect(excerpt.logs.endsWith("tail")).toBe(true);
  expect(logExcerpt([encode("x".repeat(5000), 1)], []).logs.length).toBe(4000);
  expect(() =>
    logExcerpt([{ data: "not base64!", line: 1, type: 1 }], []),
  ).toThrow("Invalid base64");
});

test("diagnostics use API step IDs for logs and CLI step numbers for commands", async () => {
  const pipeline = ciFixture().pipeline;
  expect(pipeline).not.toBeNull();
  if (pipeline === null) throw new Error("Missing fixture");
  pipeline.workflows = [
    {
      name: "verify",
      state: "failure",
      pid: 2,
      children: [
        {
          name: "service",
          state: "failure",
          id: 44,
          pid: 3,
          type: "service",
          exit_code: 137,
        },
        {
          name: "verify",
          state: "failure",
          id: 55,
          pid: 4,
          type: "step",
          exit_code: 1,
        },
      ],
    },
    {
      name: "successful-workflow",
      state: "success",
      children: [
        {
          name: "service",
          state: "failure",
          id: 66,
          pid: 5,
          type: "service",
          exit_code: 137,
        },
      ],
    },
  ];
  const fetchMock = vi.fn(async (_url: URL) =>
    json([
      { data: Buffer.from("test failed").toString("base64"), line: 1, type: 1 },
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await pipelineDiagnostics(pipeline, config);
  expect(result).toHaveLength(1);
  expect(result[0]?.stepId).toBe(55);
  expect(result[0]?.command).toContain("monorepo 7 4");
  expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("/logs/7/55");
});
