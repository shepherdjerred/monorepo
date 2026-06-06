import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  cancelBuildkiteBuildsForBranchImpl,
  type FetchFn,
} from "./cancel-buildkite-builds.ts";
import type { CancelBuildkiteBuildsInput } from "#shared/schemas.ts";

const INPUT: CancelBuildkiteBuildsInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 42,
  branch: "feature/foo",
  commitSha: "ab".repeat(20),
  merged: true,
};

let savedToken: string | undefined;
let savedOrg: string | undefined;
let savedPipeline: string | undefined;

const forbiddenFetch: FetchFn = () =>
  Promise.resolve(new Response("forbidden", { status: 403 }));

beforeEach(() => {
  savedToken = Bun.env["BUILDKITE_API_TOKEN"];
  savedOrg = Bun.env["BUILDKITE_ORGANIZATION_SLUG"];
  savedPipeline = Bun.env["BUILDKITE_PIPELINE_SLUG"];
  Bun.env["BUILDKITE_API_TOKEN"] = "bk-test-token";
  Bun.env["BUILDKITE_ORGANIZATION_SLUG"] = "sjerred";
  Bun.env["BUILDKITE_PIPELINE_SLUG"] = "monorepo";
});

// Restore each var to its pre-test value — deleting (not blanking to "") when
// it was genuinely absent, so a var that was unset before this suite stays
// unset after, preserving isolation for any later test that distinguishes
// undefined from "". Literal keys keep this clear of no-dynamic-delete.
afterEach(() => {
  if (savedToken === undefined) {
    delete Bun.env["BUILDKITE_API_TOKEN"];
  } else {
    Bun.env["BUILDKITE_API_TOKEN"] = savedToken;
  }
  if (savedOrg === undefined) {
    delete Bun.env["BUILDKITE_ORGANIZATION_SLUG"];
  } else {
    Bun.env["BUILDKITE_ORGANIZATION_SLUG"] = savedOrg;
  }
  if (savedPipeline === undefined) {
    delete Bun.env["BUILDKITE_PIPELINE_SLUG"];
  } else {
    Bun.env["BUILDKITE_PIPELINE_SLUG"] = savedPipeline;
  }
});

function listBody(numbers: number[]): Response {
  return Response.json(
    numbers.map((n) => ({
      number: n,
      state: "running",
      branch: "feature/foo",
    })),
  );
}

/**
 * Module-scope stub factory so the per-test fetch fns don't need to live
 * inside the `it` closures (consistent-function-scoping). `builds` is the list
 * payload; `putStatus` is the status returned for every cancel PUT.
 */
function stubFetch(builds: number[], putStatus: number): FetchFn {
  return (_url, init) => {
    if (init?.method === "PUT") {
      return Promise.resolve(new Response("x", { status: putStatus }));
    }
    return Promise.resolve(listBody(builds));
  };
}

describe("cancelBuildkiteBuildsForBranchImpl", () => {
  it("lists active builds and issues a cancel PUT for each", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchFn: FetchFn = (url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "PUT") {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(listBody([101, 102]));
    };

    const result = await cancelBuildkiteBuildsForBranchImpl(INPUT, fetchFn);

    expect(result).toEqual({ cancelled: [101, 102], skipped: 0 });

    const listCall = calls[0];
    if (listCall === undefined) {
      throw new Error("expected a list call");
    }
    // Branch filter + active-state filter are present on the list query.
    expect(listCall.url).toContain("branch=feature%2Ffoo");
    expect(listCall.url).toContain("state%5B%5D=running");
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds/101/cancel",
      "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds/102/cancel",
    ]);
  });

  it("counts a 4xx on cancel as a benign skip, not a failure", async () => {
    // Build finished between list and cancel → 422.
    const result = await cancelBuildkiteBuildsForBranchImpl(
      INPUT,
      stubFetch([200], 422),
    );
    expect(result).toEqual({ cancelled: [], skipped: 1 });
  });

  it("throws on a 5xx cancel so Temporal retries", async () => {
    await expect(
      cancelBuildkiteBuildsForBranchImpl(INPUT, stubFetch([300], 503)),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws a scope-specific error on a 403 list response", async () => {
    await expect(
      cancelBuildkiteBuildsForBranchImpl(INPUT, forbiddenFetch),
    ).rejects.toThrow(/write_builds/);
  });

  it("throws when BUILDKITE_API_TOKEN is missing", async () => {
    Bun.env["BUILDKITE_API_TOKEN"] = "";
    await expect(
      cancelBuildkiteBuildsForBranchImpl(INPUT, stubFetch([], 200)),
    ).rejects.toThrow(/BUILDKITE_API_TOKEN/);
  });

  it("does nothing when there are no active builds", async () => {
    let puts = 0;
    const fetchFn: FetchFn = (_url, init) => {
      if (init?.method === "PUT") {
        puts++;
      }
      return Promise.resolve(listBody([]));
    };

    const result = await cancelBuildkiteBuildsForBranchImpl(INPUT, fetchFn);
    expect(result).toEqual({ cancelled: [], skipped: 0 });
    expect(puts).toBe(0);
  });
});
