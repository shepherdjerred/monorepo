import { describe, expect, test } from "vitest";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function pipeline(number: number, status: string) {
  return {
    number,
    status,
    commit: `sha${String(number)}`,
    message: `commit ${String(number)}\n\nbody`,
    created: 1_790_000_000,
    finished: status === "running" ? 0 : 1_790_001_800,
  };
}

function client(fetch: ReturnType<typeof sequence>["fetch"]) {
  return new WoodpeckerClient({
    baseUrl: "https://woodpecker.sjer.red",
    token: "wp",
    repoId: 1,
    fetch,
  });
}

describe("WoodpeckerClient", () => {
  test("separates the newest pipeline from the newest verdict", async () => {
    const { fetch, requests } = sequence([
      pipeline(102, "running"),
      pipeline(101, "killed"),
      pipeline(100, "failure"),
      pipeline(99, "success"),
    ]);
    const status = await client(fetch).branchStatus("main");
    expect(status.latest).toMatchObject({ number: 102, finishedAt: undefined });
    expect(status.verdict).toMatchObject({
      number: 100,
      status: "failure",
      message: "commit 100",
      url: "https://woodpecker.sjer.red/repos/1/pipeline/100",
      finishedAt: "2026-09-21T14:43:20.000Z",
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/repos/1/pipelines");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer wp");
  });

  /**
   * Woodpecker files a pull request's pipeline under its target branch, so a
   * red pull request would otherwise read as a red main.
   */
  test("reads push pipelines only", async () => {
    const { fetch, requests } = sequence([pipeline(1, "success")]);
    await client(fetch).branchStatus("main");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("event")).toBe(
      "push",
    );
  });

  test("a configuration error is a red verdict", async () => {
    const { fetch } = sequence([pipeline(5, "error"), pipeline(4, "success")]);
    const status = await client(fetch).branchStatus("main");
    expect(status.verdict).toMatchObject({ number: 5, status: "error" });
  });

  test("an unknown pipeline status fails loudly", async () => {
    const { fetch } = sequence([pipeline(1, "exploded")]);
    await expect(client(fetch).branchStatus("main")).rejects.toThrow(
      /woodpecker: response did not match schema/,
    );
  });
});
