import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelCiPipelinesForBranchImpl,
  type FetchFn,
} from "./cancel-ci-pipelines.ts";
import type { CancelCiPipelinesInput } from "#shared/schemas.ts";

const INPUT: CancelCiPipelinesInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 42,
  branch: "feature/foo",
  commitSha: "ab".repeat(20),
  merged: true,
};

const SERVER = "https://woodpecker.example.com";

let savedToken: string | undefined;
let savedServer: string | undefined;
let savedRepoId: string | undefined;

const forbiddenFetch: FetchFn = () =>
  Promise.resolve(new Response("forbidden", { status: 403 }));

beforeEach(() => {
  savedToken = Bun.env["WOODPECKER_TOKEN"];
  savedServer = Bun.env["WOODPECKER_URL"];
  savedRepoId = Bun.env["WOODPECKER_REPO_ID"];
  Bun.env["WOODPECKER_TOKEN"] = "wp-test-token";
  Bun.env["WOODPECKER_URL"] = SERVER;
  Bun.env["WOODPECKER_REPO_ID"] = "7";
});

// Restore each var to its pre-test value — deleting (not blanking to "") when
// it was genuinely absent, so a var that was unset before this suite stays
// unset after, preserving isolation for any later test that distinguishes
// undefined from "". Literal keys keep this clear of no-dynamic-delete.
afterEach(() => {
  if (savedToken === undefined) {
    delete Bun.env["WOODPECKER_TOKEN"];
  } else {
    Bun.env["WOODPECKER_TOKEN"] = savedToken;
  }
  if (savedServer === undefined) {
    delete Bun.env["WOODPECKER_URL"];
  } else {
    Bun.env["WOODPECKER_URL"] = savedServer;
  }
  if (savedRepoId === undefined) {
    delete Bun.env["WOODPECKER_REPO_ID"];
  } else {
    Bun.env["WOODPECKER_REPO_ID"] = savedRepoId;
  }
});

function listBody(
  numbers: number[],
  status = "running",
  branch = "feature/foo",
): Response {
  return Response.json(numbers.map((n) => ({ number: n, status, branch })));
}

/**
 * Module-scope stub factory so the per-test fetch fns don't need to live
 * inside the `it` closures (consistent-function-scoping). `pipelines` is the
 * list payload; `cancelStatus` is returned for every cancel POST.
 */
function stubFetch(pipelines: number[], cancelStatus: number): FetchFn {
  return (_url, init) => {
    return init?.method === "POST"
      ? Promise.resolve(new Response("x", { status: cancelStatus }))
      : Promise.resolve(listBody(pipelines));
  };
}

const otherBranchFetch: FetchFn = (_url, init) =>
  init?.method === "POST"
    ? Promise.resolve(new Response("{}", { status: 200 }))
    : Promise.resolve(listBody([600], "running", "other-branch"));

describe("cancelCiPipelinesForBranchImpl", () => {
  it("lists active pipelines and issues a cancel POST for each", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchFn: FetchFn = (url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return init?.method === "POST"
        ? Promise.resolve(new Response("{}", { status: 200 }))
        : Promise.resolve(listBody([101, 102]));
    };

    const result = await cancelCiPipelinesForBranchImpl(INPUT, fetchFn);

    expect(result).toEqual({ cancelled: [101, 102], skipped: 0 });

    const listCall = calls[0];
    if (listCall === undefined) {
      throw new Error("expected a list call");
    }
    expect(listCall.url).toContain("branch=feature%2Ffoo");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([
      `${SERVER}/api/repos/7/pipelines/101/cancel`,
      `${SERVER}/api/repos/7/pipelines/102/cancel`,
    ]);
  });

  /**
   * Woodpecker's list endpoint takes a single status, so the active filter is
   * applied client-side. A terminal pipeline must never be re-cancelled.
   */
  it("ignores pipelines in a terminal status", async () => {
    let cancels = 0;
    const fetchFn: FetchFn = (_url, init) => {
      if (init?.method === "POST") {
        cancels++;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(listBody([500], "success"));
    };
    const result = await cancelCiPipelinesForBranchImpl(INPUT, fetchFn);
    expect(result).toEqual({ cancelled: [], skipped: 0 });
    expect(cancels).toBe(0);
  });

  /** Cancelling another branch's build would be far worse than over-listing. */
  it("ignores a pipeline the server returned for a different branch", async () => {
    const result = await cancelCiPipelinesForBranchImpl(
      INPUT,
      otherBranchFetch,
    );
    expect(result).toEqual({ cancelled: [], skipped: 0 });
  });

  it("counts a 4xx on cancel as a benign skip, not a failure", async () => {
    // Pipeline finished between list and cancel.
    const result = await cancelCiPipelinesForBranchImpl(
      INPUT,
      stubFetch([200], 422),
    );
    expect(result).toEqual({ cancelled: [], skipped: 1 });
  });

  it("throws on a 5xx cancel so Temporal retries", async () => {
    await expect(
      cancelCiPipelinesForBranchImpl(INPUT, stubFetch([300], 503)),
    ).rejects.toThrow(/HTTP 503/u);
  });

  it("throws an authorization error on a 403 list response", async () => {
    await expect(
      cancelCiPipelinesForBranchImpl(INPUT, forbiddenFetch),
    ).rejects.toThrow(/not authorized/u);
  });

  it("throws when WOODPECKER_TOKEN is missing", async () => {
    Bun.env["WOODPECKER_TOKEN"] = "";
    await expect(
      cancelCiPipelinesForBranchImpl(INPUT, stubFetch([], 200)),
    ).rejects.toThrow(/WOODPECKER_TOKEN/u);
  });

  it("does nothing when there are no active pipelines", async () => {
    let cancels = 0;
    const fetchFn: FetchFn = (_url, init) => {
      if (init?.method === "POST") {
        cancels++;
      }
      return Promise.resolve(listBody([]));
    };

    const result = await cancelCiPipelinesForBranchImpl(INPUT, fetchFn);
    expect(result).toEqual({ cancelled: [], skipped: 0 });
    expect(cancels).toBe(0);
  });
});
