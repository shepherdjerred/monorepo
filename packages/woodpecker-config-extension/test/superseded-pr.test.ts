import { describe, expect, test } from "vitest";
import { cancelSupersededPr } from "#src/superseded-pr.ts";
import type { FetchLike } from "#src/http.ts";

const current = {
  number: 100,
  ref: "refs/pull/42/merge",
  event: "pull_request",
  event_reason: null,
  pr_draft: false,
};
const older = {
  ...current,
  number: 99,
  status: "running",
  event: "pull_request_metadata",
  event_reason: ["ready_for_review"],
};
type Summary = Omit<typeof older, "event_reason"> & {
  event_reason: string[] | null;
};

function harness(
  list: Summary[],
  mutate?: (value: Summary) => Summary,
  cancelStatus = 204,
) {
  const calls: {
    url: URL;
    method: string;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, method: init?.method ?? "GET", signal: init?.signal });
    if (url.pathname.endsWith("/cancel"))
      return new Response(null, { status: cancelStatus });
    const number = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
    if (number !== undefined) {
      const value = list.find((entry) => entry.number === Number(number));
      if (value === undefined) throw new Error("unexpected detail request");
      return Response.json(mutate?.(value) ?? value);
    }
    return Response.json(list);
  };
  return {
    options: {
      baseUrl: "https://woodpecker.example.com",
      token: "test",
      fetchImpl,
    },
    calls,
  };
}

describe("PR supersession", () => {
  test("a new PR run cancels only older verification for its exact PR", async () => {
    const { options, calls } = harness([
      older,
      { ...older, number: 98, ref: "refs/pull/42/head" },
      { ...older, number: 97, ref: "refs/pull/420/merge" },
      { ...older, number: 96, event_reason: ["edited"] },
      { ...older, number: 95, event: "pull_request" },
      { ...older, number: 94, status: "success" },
      { ...older, number: 93, pr_draft: true },
      { ...older, number: 101 },
      { ...older, number: 100 },
      { ...older, number: 92, event: "push" },
    ]);
    expect(await cancelSupersededPr(7, current, options)).toEqual([99, 98, 95]);
    expect(
      calls
        .filter((call) => call.method === "POST")
        .map((call) => call.url.pathname),
    ).toEqual([
      "/api/repos/7/pipelines/99/cancel",
      "/api/repos/7/pipelines/98/cancel",
      "/api/repos/7/pipelines/95/cancel",
    ]);
    expect(calls[0]?.url.searchParams.get("event")).toBe(
      "pull_request,pull_request_metadata",
    );
    expect(new Set(calls.map((call) => call.signal)).size).toBe(1);
  });

  test("retargeting supersedes the older run even at the same commit", async () => {
    const oldTarget = {
      ...older,
      event: "pull_request",
      branch: "old-base",
      commit: "a".repeat(40),
    };
    const { options } = harness([oldTarget]);
    const newTarget = {
      ...current,
      branch: "new-base",
      commit: oldTarget.commit,
    };
    expect(await cancelSupersededPr(7, newTarget, options)).toEqual([99]);
  });

  test("ready transition supersedes both old PR work and old ready work", async () => {
    const { options } = harness([
      older,
      { ...older, number: 98, event: "pull_request", pr_draft: true },
    ]);
    expect(
      await cancelSupersededPr(7, { ...older, number: 100 }, options),
    ).toEqual([99, 98]);
  });

  test.each([
    { event: "pull_request_metadata", event_reason: ["edited"] },
    { event: "pull_request_metadata", event_reason: ["label_updated"] },
    {
      event: "pull_request_metadata",
      event_reason: ["ready_for_review"],
      pr_draft: true,
    },
    { event: "push" },
    { ref: "refs/heads/main" },
    { number: 0 },
  ])("does not touch active work for %j", async (patch) => {
    const { options, calls } = harness([older]);
    expect(
      await cancelSupersededPr(7, { ...current, ...patch }, options),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("revalidates status and identity immediately before cancellation", async () => {
    const finished = harness([older], (value) => ({
      ...value,
      status: "success",
    }));
    expect(await cancelSupersededPr(7, current, finished.options)).toEqual([]);
    expect(finished.calls.some((call) => call.method === "POST")).toBe(false);
    const changed = harness([older], (value) => ({
      ...value,
      ref: "refs/pull/43/merge",
    }));
    await expect(
      cancelSupersededPr(7, current, changed.options),
    ).rejects.toThrow("identity changed");
    expect(changed.calls.some((call) => call.method === "POST")).toBe(false);
  });

  test("recognizes completion racing cancellation and surfaces genuine failures", async () => {
    let reads = 0;
    const raced = harness(
      [older],
      (value) => ({ ...value, status: ++reads === 1 ? "running" : "success" }),
      400,
    );
    expect(await cancelSupersededPr(7, current, raced.options)).toEqual([]);
    const failed = harness([older], undefined, 403);
    await expect(
      cancelSupersededPr(7, current, failed.options),
    ).rejects.toThrow("403");
  });

  test("fails before mutation when a bounded scan cannot establish candidates", async () => {
    const { options, calls } = harness(
      Array.from({ length: 50 }, (_, i) => ({ ...older, number: i + 1 })),
    );
    await expect(cancelSupersededPr(7, current, options)).rejects.toThrow(
      "bounded active-pipeline scan",
    );
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(calls).toHaveLength(5);
  });
});
