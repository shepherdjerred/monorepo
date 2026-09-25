import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  lastCommitWithSuccessfulWorkflows,
  lastSuccessfulCommit,
} from "#src/woodpecker-api.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY } from "./identity.ts";

const IMAGES = {
  base: "ghcr.io/shepherdjerred/ci-base@sha256:" + "a".repeat(64),
  playwright: "ghcr.io/shepherdjerred/ci-playwright@sha256:" + "b".repeat(64),
  windowsCrossCompilerWinui: `ghcr.io/shepherdjerred/windows-cross-compiler-winui@sha256:${"c".repeat(64)}`,
  catalog: {
    "aquasec/trivy": "aquasec/trivy:0.72.0",
    "semgrep/semgrep": "semgrep/semgrep:1.170.0",
    "texlive/texlive": "texlive/texlive:TL2024-historic",
    "trmnl/trmnlp": "trmnl/trmnlp:v0.11.0",
    "grafana/tempo": "grafana/tempo:3.0.3",
    "mikefarah/yq": "mikefarah/yq:latest",
    "minio/mc": "minio/mc:RELEASE",
    "minio/minio": "minio/minio:RELEASE",
  },
};

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
  pipelines: { number: number; commit: string }[],
  workflows: Record<number, { name: string; state: string }[]>,
) {
  return async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const match = /\/pipelines\/(?<number>\d+)$/u.exec(url.pathname);
    const number = match?.groups?.["number"];
    if (number === undefined) return jsonResponse(pipelines);
    const parsed = Number(number);
    return jsonResponse({
      commit: pipelines.find((p) => p.number === parsed)?.commit ?? "unknown",
      status: "success",
      workflows: workflows[parsed] ?? [],
    });
  };
}

describe("last commit with successful workflows", () => {
  const options = {
    baseUrl: "https://woodpecker.example.com",
    token: "t",
  };

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
});
