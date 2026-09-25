import { describe, expect, test } from "vitest";
import { BuildkiteClient } from "@shepherdjerred/ops-clients/buildkite.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function build(number: number, state: string) {
  return {
    number,
    state,
    web_url: `https://buildkite.com/sjerred/monorepo/builds/${String(number)}`,
    commit: `sha${String(number)}`,
    message: `commit ${String(number)}\n\nbody`,
    created_at: "2026-09-24T10:00:00Z",
    finished_at: state === "running" ? null : "2026-09-24T10:30:00Z",
  };
}

describe("BuildkiteClient", () => {
  test("separates the newest build from the newest verdict", async () => {
    const { fetch, requests } = sequence([
      build(102, "running"),
      build(101, "canceled"),
      build(100, "failed"),
      build(99, "passed"),
    ]);
    const client = new BuildkiteClient({
      token: "bk",
      organization: "sjerred",
      pipeline: "monorepo",
      fetch,
    });
    const status = await client.branchStatus("main");
    expect(status.latest?.number).toBe(102);
    expect(status.verdict).toMatchObject({
      number: 100,
      state: "failed",
      message: "commit 100",
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe(
      "/v2/organizations/sjerred/pipelines/monorepo/builds",
    );
    expect(url.searchParams.get("branch")).toBe("main");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer bk");
  });

  test("an unknown build state fails loudly", async () => {
    const { fetch } = sequence([build(1, "exploded")]);
    const client = new BuildkiteClient({
      token: "bk",
      organization: "sjerred",
      pipeline: "monorepo",
      fetch,
    });
    await expect(client.branchStatus("main")).rejects.toThrow(
      /buildkite: response did not match schema/,
    );
  });
});
