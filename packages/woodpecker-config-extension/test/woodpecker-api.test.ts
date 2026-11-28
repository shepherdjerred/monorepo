import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  lastCommitWithSuccessfulWorkflows,
  lastPipelineWithSuccessfulWorkflows,
  lastSuccessfulCommit,
} from "#src/woodpecker-api.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, TEST_IMAGES as IMAGES } from "./identity.ts";

function jsonResponse(body: unknown): Response {
  return Response.json(body);
}

describe("last successful commit", () => {
  test("queries the default branch for successful push pipelines", async () => {
    let seen: URL | undefined;
    const commit = await lastSuccessfulCommit(7, "main", {
      baseUrl: "https://woodpecker.example.com",
      token: "t",
      fetchImpl: async (input) => {
        seen = new URL(input instanceof Request ? input.url : input);
        return jsonResponse([{ commit: "abc", status: "success" }]);
      },
    });
    expect(commit).toBe("abc");
    expect(seen?.pathname).toBe("/api/repos/7/pipelines");
    expect(seen?.searchParams.get("branch")).toBe("main");
    expect(seen?.searchParams.get("status")).toBe("success");
  });

  /**
   * A branch that has never gone green must compare against nothing, which
   * selects every lane. A plausible-but-wrong base would silently narrow CI.
   */
  test("returns undefined when nothing has ever succeeded", async () => {
    const commit = await lastSuccessfulCommit(7, "main", {
      baseUrl: "https://woodpecker.example.com",
      token: "t",
      fetchImpl: async () => jsonResponse([]),
    });
    expect(commit).toBeUndefined();
  });

  /** Do not trust the server to have honoured the status filter. */
  test("ignores a non-successful pipeline even if the server returns one", async () => {
    const commit = await lastSuccessfulCommit(7, "main", {
      baseUrl: "https://woodpecker.example.com",
      token: "t",
      fetchImpl: async () =>
        jsonResponse([{ commit: "bad", status: "failure" }]),
    });
    expect(commit).toBeUndefined();
  });

  test("fails loudly on an API error", async () => {
    await expect(
      lastSuccessfulCommit(7, "main", {
        baseUrl: "https://woodpecker.example.com",
        token: "t",
        fetchImpl: async () => new Response("", { status: 500 }),
      }),
    ).rejects.toThrow(/could not list Woodpecker pipelines \(500\)/u);
  });
});

describe("changed base injection", () => {
  test("writes the resolved base into the step environment", () => {
    const [step] = buildPipelineSteps({
      images: IMAGES,
      changedBase: "deadbeef",
    });
    expect(step?.environment).toMatchObject({ CI_CHANGED_BASE: "deadbeef" });
  });

  test("passes an empty base through rather than omitting it", () => {
    const [step] = buildPipelineSteps({
      images: IMAGES,
      changedBase: undefined,
    });
    expect(step?.environment).toMatchObject({ CI_CHANGED_BASE: "" });
    const parsed: unknown = parse(emitWorkflow(step!, TEST_IDENTITY));
    expect(parsed).toMatchObject({
      steps: [{ environment: { CI_CHANGED_BASE: "" } }],
    });
  });
});

function server(
  pipelines: { number: number; commit: string; status?: string }[],
  workflows: Record<number, { name: string; state: string }[]>,
  observedUrls?: URL[],
) {
  return async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    observedUrls?.push(url);
    const match = /\/pipelines\/(?<number>\d+)$/u.exec(url.pathname);
    const number = match?.groups?.["number"];
    if (number === undefined) {
      return jsonResponse(
        pipelines.map((entry) => ({ status: "success", ...entry })),
      );
    }
    const parsed = Number(number);
    return jsonResponse({
      commit: pipelines.find((p) => p.number === parsed)?.commit ?? "unknown",
      status: pipelines.find((p) => p.number === parsed)?.status ?? "success",
      workflows: workflows[parsed] ?? [],
    });
  };
}

describe("last commit with successful workflows", () => {
  const options = {
    baseUrl: "https://woodpecker.example.com",
    token: "t",
  };

  test("artifact reuse requires the complete producing pipeline to succeed", async () => {
    const fetchImpl = server(
      [
        { number: 101, commit: "failed-review", status: "failure" },
        { number: 100, commit: "qualified" },
      ],
      {
        101: [
          { name: "images", state: "success" },
          { name: "helm-push", state: "success" },
        ],
        100: [
          { name: "images", state: "success" },
          { name: "helm-push", state: "success" },
        ],
      },
    );
    await expect(
      lastPipelineWithSuccessfulWorkflows(7, "main", ["images", "helm-push"], {
        ...options,
        fetchImpl,
        requirePipelineSuccess: true,
      }),
    ).resolves.toEqual({ commit: "qualified", pipelineNumber: 100 });
    await expect(
      lastPipelineWithSuccessfulWorkflows(7, "main", ["images", "helm-push"], {
        ...options,
        fetchImpl,
      }),
    ).resolves.toEqual({ commit: "failed-review", pipelineNumber: 101 });
  });

  test("keeps the qualifying commit paired with its pipeline's handoffs", async () => {
    await expect(
      lastPipelineWithSuccessfulWorkflows(
        7,
        "main",
        ["images", "version-commit-back"],
        {
          ...options,
          fetchImpl: server(
            [
              { number: 6524, commit: "newer-failed-release" },
              { number: 6485, commit: "published-release" },
            ],
            {
              6524: [
                { name: "images", state: "success" },
                { name: "version-commit-back", state: "killed" },
              ],
              6485: [
                { name: "images", state: "success" },
                { name: "version-commit-back", state: "success" },
              ],
            },
          ),
        },
      ),
    ).resolves.toEqual({ commit: "published-release", pipelineNumber: 6485 });
  });

  test("returns the newest commit where every named workflow succeeded", async () => {
    const commit = await lastCommitWithSuccessfulWorkflows(
      7,
      "main",
      ["images", "version-commit-back"],
      {
        ...options,
        fetchImpl: server(
          [
            { number: 3, commit: "newest" },
            { number: 2, commit: "older" },
          ],
          {
            3: [{ name: "images", state: "success" }],
            2: [
              { name: "images", state: "success" },
              { name: "version-commit-back", state: "success" },
            ],
          },
        ),
      },
    );
    // Pipeline 3 is newer but never pinned, so it cannot be the base.
    expect(commit).toBe("older");
  });

  /**
   * A pipeline can go green overall with these workflows skipped. Treating
   * such a commit as the base would make the next build believe images exist
   * for content that was never built.
   */
  test("ignores a green pipeline whose workflows were skipped", async () => {
    const commit = await lastCommitWithSuccessfulWorkflows(
      7,
      "main",
      ["images"],
      {
        ...options,
        fetchImpl: server([{ number: 5, commit: "green" }], {
          5: [{ name: "images", state: "skipped" }],
        }),
      },
    );
    expect(commit).toBeUndefined();
  });

  test("returns undefined when nothing qualifies", async () => {
    const commit = await lastCommitWithSuccessfulWorkflows(
      7,
      "main",
      ["images"],
      { ...options, fetchImpl: server([], {}) },
    );
    expect(commit).toBeUndefined();
  });

  test("filters status=success with perPage=5 when requirePipelineSuccess is true", async () => {
    const observed: URL[] = [];
    const result = await lastPipelineWithSuccessfulWorkflows(
      7,
      "main",
      ["images", "helm-push"],
      {
        ...options,
        requirePipelineSuccess: true,
        fetchImpl: server(
          [
            { number: 202, commit: "canceled-run", status: "canceled" },
            { number: 201, commit: "green-release", status: "success" },
          ],
          {
            201: [
              { name: "images", state: "success" },
              { name: "helm-push", state: "success" },
            ],
          },
          observed,
        ),
      },
    );
    expect(result).toEqual({ commit: "green-release", pipelineNumber: 201 });
    expect(observed[0]?.searchParams.get("status")).toBe("success");
    expect(observed[0]?.searchParams.get("perPage")).toBe("5");
    expect(observed.map((url) => url.pathname)).toEqual([
      "/api/repos/7/pipelines",
      "/api/repos/7/pipelines/201",
    ]);
  });

  test("scans past >20 consecutive canceled/killed runs without N+1 detail fetches", async () => {
    const observed: URL[] = [];
    const canceled = Array.from({ length: 30 }, (_, index) => ({
      number: 500 - index,
      commit: `canceled-${String(index)}`,
      status: index % 2 === 0 ? "canceled" : "killed",
    }));
    const commit = await lastCommitWithSuccessfulWorkflows(
      7,
      "main",
      ["verify"],
      {
        ...options,
        fetchImpl: server(
          [
            ...canceled,
            { number: 470, commit: "skipped-run", status: "skipped" },
            { number: 469, commit: "declined-run", status: "declined" },
            { number: 468, commit: "verified-base", status: "failure" },
          ],
          {
            468: [{ name: "verify", state: "success" }],
          },
          observed,
        ),
      },
    );
    expect(commit).toBe("verified-base");
    expect(observed[0]?.searchParams.get("perPage")).toBe("50");
    expect(observed[0]?.searchParams.get("status")).toBeNull();
    expect(observed.map((url) => url.pathname)).toEqual([
      "/api/repos/7/pipelines",
      "/api/repos/7/pipelines/468",
    ]);
  });
});
