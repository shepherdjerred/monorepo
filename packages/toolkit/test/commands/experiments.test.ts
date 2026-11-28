import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "fixture-experiments-token";
const ENTRYPOINT = fileURLToPath(
  new URL("../../src/index.ts", import.meta.url),
);
const HUB_URL = `https://hub.tailnet-1a49.ts.net/experiments/${ID}`;

const SUMMARY = {
  id: ID,
  revision: 2,
  title: "Compare CI cancellation paths",
  owner: "Operator",
  status: "running",
  reviewDate: "2026-11-26",
  createdAt: "2026-11-26T18:00:00Z",
  updatedAt: "2026-11-26T18:01:00Z",
  startedAt: "2026-11-26T18:01:00Z",
  decidedAt: null,
  isDue: true,
  decision: null,
};

const PLAN = {
  change: "Use the new wait path",
  hypothesis: "The new path returns sooner",
  scope: "CI CLI only",
  successCriteria: "The current verdict remains accurate",
  measurementMethod: "Compare the captured CLI outputs",
  baseline: "",
  guardrails: "",
};

const RECORD = {
  ...SUMMARY,
  plan: PLAN,
  originalPlan: PLAN,
  originalReviewDate: SUMMARY.reviewDate,
  timeline: [],
};

async function run(args: string[], url: URL, input?: string) {
  const child = Bun.spawn(
    ["bun", ENTRYPOINT, "experiments", ...args, "--url", url.origin],
    {
      env: { ...Bun.env, EXPERIMENTS_MACHINE_TOKEN: TOKEN },
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("toolkit experiments", () => {
  test("passes filters and returns canonical Hub URLs", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(request.url);
        return Response.json({ items: [SUMMARY] });
      },
    });
    try {
      const result = await run(
        ["list", "--view", "due", "--q", "cancellation", "--json"],
        server.url,
      );
      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(result.stdout.trim()).toBe(
        JSON.stringify({ items: [{ ...SUMMARY, url: HUB_URL }] }),
      );
      expect(requests).toEqual([
        `${server.url.origin}/api/v1/experiments?view=due&q=cancellation`,
      ]);
    } finally {
      await server.stop(true);
    }
  });

  test("reads evidence from stdin and sends the revision and request ID", async () => {
    const requests: {
      path: string;
      method: string;
      authenticated: boolean;
      body: unknown;
    }[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push({
          path: new URL(request.url).pathname,
          method: request.method,
          authenticated:
            request.headers.get("authorization") === `Bearer ${TOKEN}`,
          body: await request.json(),
        });
        return Response.json(RECORD);
      },
    });
    try {
      const evidence = { note: "Both paths returned the same verdict." };
      const result = await run(
        [
          "evidence",
          ID,
          "--expected-revision",
          "1",
          "--request-id",
          REQUEST_ID,
          "--file",
          "-",
          "--json",
        ],
        server.url,
        JSON.stringify(evidence),
      );
      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(result.stdout.trim()).toContain(`"url":"${HUB_URL}"`);
      expect(requests).toEqual([
        {
          path: `/api/v1/experiments/${ID}/evidence`,
          method: "POST",
          authenticated: true,
          body: { ...evidence, expectedRevision: 1, requestId: REQUEST_ID },
        },
      ]);
    } finally {
      await server.stop(true);
    }
  });

  test("exits nonzero for a refused write and redacts any echoed token", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json(
          { code: "conflict", error: `Revision changed (${TOKEN}).` },
          { status: 409 },
        );
      },
    });
    try {
      const result = await run(
        ["start", ID, "--expected-revision", "1", "--json"],
        server.url,
      );
      expect(result).toMatchObject({ code: 1, stdout: "" });
      expect(result.stderr).toContain(
        "Experiments API request failed (409). Revision changed ([redacted]).",
      );
      expect(result.stderr).not.toContain(TOKEN);
    } finally {
      await server.stop(true);
    }
  });
});
