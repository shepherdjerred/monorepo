import { describe, expect, test } from "vitest";
import { TrackerClient } from "./tracker.ts";
import { sequence } from "./test-support/fake-fetch.ts";

const issue = (
  identifier: string,
  team: string,
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  id: identifier,
  identifier,
  title: identifier,
  createdAt: "2026-09-24T00:00:00Z",
  team: { key: team },
  state: { type },
  ...extra,
});

const page = (items: unknown[], nextCursor: string | null) => ({
  result: { data: { items, nextCursor } },
});

describe("TrackerClient open issues", () => {
  test("paginates all open issues without credentials or cycles", async () => {
    const { fetch, requests } = sequence(
      page([issue("SJ-1", "SJ", "triage")], "next"),
      page([issue("AI-1", "AI", "started")], null),
    );
    const overview = await new TrackerClient({
      baseUrl: "http://tracker.tracker.svc.cluster.local:7351",
      publicUrl: "https://tracker.example",
      fetch,
    }).overview();
    expect(overview.counts).toEqual({ SJ: { triage: 1 }, AI: { started: 1 } });
    expect(overview.triage.map((item) => item.identifier)).toEqual(["SJ-1"]);
    expect(overview.open[0]?.url).toBe("https://tracker.example/issues/SJ-1");
    expect(requests).toHaveLength(2);
    expect(new URL(requests[0]?.url ?? "").origin).toBe(
      "http://tracker.tracker.svc.cluster.local:7351",
    );
    expect(
      requests.every(
        (request) => request.headers.get("authorization") === null,
      ),
    ).toBe(true);
    const rawInput =
      new URL(requests[1]?.url ?? "").searchParams.get("input") ?? "{}";
    const parsedInput: unknown = JSON.parse(rawInput);
    expect(parsedInput).toMatchObject({
      cursor: "next",
      states: ["triage", "backlog", "unstarted", "started"],
    });
  });

  test("rejects unknown states and repeated cursors", async () => {
    const invalid = sequence(page([issue("AI-1", "AI", "someday")], null));
    await expect(
      new TrackerClient({
        baseUrl: "http://tracker.tracker.svc.cluster.local:7351",
        publicUrl: "https://tracker.example",
        fetch: invalid.fetch,
      }).overview(),
    ).rejects.toThrow("schema");
    const repeated = sequence(page([], "next"), page([], "next"));
    await expect(
      new TrackerClient({
        baseUrl: "http://tracker.tracker.svc.cluster.local:7351",
        publicUrl: "https://tracker.example",
        fetch: repeated.fetch,
      }).overview(),
    ).rejects.toThrow("repeated issue cursor");
  });
});

describe("TrackerClient forum and throughput", () => {
  test("reads active forum notices and unanswered questions", async () => {
    const { fetch } = sequence(
      page(
        [
          {
            id: "n1",
            identifier: "FM-10",
            kind: "notice",
            title: "Delivery paused for PostgreSQL upgrade",
            scopes: ["delivery", "postgres"],
            creator: { key: "agent-ops" },
            owner: { key: "jerred" },
            exitCondition: "Upgrade verified",
            expiresAt: "2026-09-25T00:00:00Z",
            replyCount: 2,
            answered: false,
            createdAt: "2026-09-24T08:00:00Z",
            lastActivityAt: "2026-09-24T09:00:00Z",
          },
        ],
        null,
      ),
      page(
        [
          {
            id: "q1",
            identifier: "FM-11",
            kind: "question",
            title: "Should Scout retain raw match payloads > 90d?",
            scopes: ["scout"],
            creator: { key: "agent-scout" },
            owner: null,
            exitCondition: null,
            expiresAt: null,
            replyCount: 0,
            answered: false,
            createdAt: "2026-09-24T10:00:00Z",
            lastActivityAt: "2026-09-24T10:00:00Z",
          },
        ],
        null,
      ),
    );
    const client = new TrackerClient({
      baseUrl: "http://tracker.tracker.svc.cluster.local:7351",
      publicUrl: "https://tracker.example",
      fetch,
    });
    const coord = await client.activeForumCoordination();
    expect(coord.notices).toEqual([
      {
        id: "n1",
        identifier: "FM-10",
        kind: "notice",
        title: "Delivery paused for PostgreSQL upgrade",
        url: "https://tracker.example/forum/FM-10",
        scopes: ["delivery", "postgres"],
        creatorKey: "agent-ops",
        ownerKey: "jerred",
        exitCondition: "Upgrade verified",
        expiresAt: "2026-09-25T00:00:00Z",
        replyCount: 2,
        answered: false,
        createdAt: "2026-09-24T08:00:00Z",
        lastActivityAt: "2026-09-24T09:00:00Z",
      },
    ]);
    expect(coord.unansweredQuestions[0]?.identifier).toBe("FM-11");
  });

  test("computes 7d completed throughput and per-project open/completed counts", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const { fetch } = sequence(
      page(
        [
          issue("AI-20", "AI", "completed", {
            updatedAt: "2026-09-23T12:00:00Z",
            completedAt: "2026-09-23T12:00:00Z",
            project: { slug: "hub", name: "Hub" },
          }),
          issue("SJ-9", "SJ", "completed", {
            updatedAt: "2026-09-20T00:00:00Z",
            completedAt: "2026-09-10T00:00:00Z",
            project: null,
          }),
          issue("AI-1", "AI", "completed", {
            updatedAt: "2026-09-01T00:00:00Z",
            completedAt: "2026-09-01T00:00:00Z",
          }),
        ],
        "ignored-more",
      ),
      {
        result: {
          data: [
            { id: "p1", slug: "hub", name: "Hub" },
            { id: "p2", slug: "dx", name: "Developer Experience" },
          ],
        },
      },
      page(
        [
          issue("AI-30", "AI", "started", {
            project: { slug: "hub", name: "Hub" },
          }),
          issue("AI-31", "AI", "triage", {
            project: { slug: "hub", name: "Hub" },
          }),
        ],
        null,
      ),
      page(
        [
          issue("AI-20", "AI", "completed", {
            completedAt: "2026-09-23T12:00:00Z",
            project: { slug: "hub", name: "Hub" },
          }),
          issue("AI-2", "AI", "completed", {
            completedAt: "2026-08-01T00:00:00Z",
            project: { slug: "hub", name: "Hub" },
          }),
        ],
        null,
      ),
    );

    const client = new TrackerClient({
      baseUrl: "http://tracker.tracker.svc.cluster.local:7351",
      publicUrl: "https://tracker.example",
      fetch,
    });

    const throughput = await client.completedThroughput7d(now);
    expect(throughput).toMatchObject({
      total: 1,
      byTeam: { AI: 1 },
      byProject: { hub: 1 },
    });
    expect(throughput.issues.map((i) => i.identifier)).toEqual(["AI-20"]);

    const projects = await client.projectIssueCounts(now);
    expect(projects).toEqual([
      {
        id: "p1",
        slug: "hub",
        name: "Hub",
        url: "https://tracker.example/projects/hub",
        open: 2,
        completed: 2,
        completed7d: 1,
      },
      {
        id: "p2",
        slug: "dx",
        name: "Developer Experience",
        url: "https://tracker.example/projects/dx",
        open: 0,
        completed: 0,
        completed7d: 0,
      },
    ]);
  });
});
