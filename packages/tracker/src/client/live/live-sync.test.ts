import { afterEach, describe, expect, test, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  bootstrapKey,
  cachedIssue,
  eventsKey,
  issueKey,
  type IssueListData,
} from "#client/data/cache.ts";
import {
  cacheFixture,
  detailFixture,
  issueFixture,
} from "#client/data/testing.ts";
import { createLiveSync, parseFrame, type LiveSyncDeps } from "./live-sync.ts";

let sequence = 0;
/** A `change` frame from another session unless overridden. */
function change(identifier: string | null, overrides: object = {}) {
  sequence += 1;
  return {
    event: "change",
    data: JSON.stringify({
      type: "change",
      eventId: `event-${String(sequence)}`,
      entityType: "issue",
      entityId: `entity-${String(sequence)}`,
      issueIdentifier: identifier,
      action: "updated",
      actorId: "actor-agent:helper",
      requestId: `remote-${String(sequence)}`,
      occurredAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    }),
  };
}
const resync = { event: "resync", data: JSON.stringify({ type: "resync" }) };

function setup(
  client: QueryClient = cacheFixture(),
  overrides: Partial<LiveSyncDeps> = {},
) {
  const fetched: string[] = [];
  const broken: string[] = [];
  const remote: [string, string][] = [];
  const created: string[][] = [];
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const sync = createLiveSync({
    client,
    fetchIssue: (identifier) => {
      fetched.push(identifier);
      const number = Number(identifier.split("-")[1]);
      return Promise.resolve(
        detailFixture(
          issueFixture(number, { revision: 2, title: `Remote ${identifier}` }),
        ),
      );
    },
    isOwn: (requestId) => requestId.startsWith("own-"),
    onBroken: (reason) => {
      broken.push(reason);
    },
    onRemoteIssue: (identifier, actorId) => {
      remote.push([identifier, actorId]);
    },
    onRemoteCreated: (identifiers) => {
      created.push(identifiers);
    },
    ...overrides,
  });
  /** Invalidations of `["issues"]`, the lists every page of which refetch. */
  const listInvalidations = () =>
    invalidate.mock.calls.filter(
      ([filters]) =>
        JSON.stringify(filters?.queryKey) === JSON.stringify(["issues"]),
    ).length;
  const invalidatedKeys = () =>
    invalidate.mock.calls.flatMap(([filters]) =>
      filters?.queryKey === undefined ? [] : [JSON.stringify(filters.queryKey)],
    );
  return {
    client,
    sync,
    fetched,
    broken,
    remote,
    created,
    listInvalidations,
    invalidatedKeys,
  };
}

const invalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryCache().find({ queryKey: key, exact: true })?.state
    .isInvalidated;

afterEach(() => {
  vi.useRealTimers();
});

describe("parsing stream frames", () => {
  test("a change and a resync match the contract", () => {
    expect(parseFrame(change("AI-1"))).toMatchObject({
      ok: true,
      message: { type: "change", issueIdentifier: "AI-1" },
    });
    expect(parseFrame(resync)).toEqual({
      ok: true,
      message: { type: "resync" },
    });
  });

  test("text that is not JSON, a missing field or a misnamed event is broken", () => {
    expect(parseFrame({ event: "change", data: "{oops" }).ok).toBe(false);
    expect(
      parseFrame({
        event: "change",
        data: JSON.stringify({ type: "change", eventId: "event-1" }),
      }).ok,
    ).toBe(false);
    expect(parseFrame({ event: "change", data: resync.data })).toMatchObject({
      ok: false,
      reason: "a resync message arrived as a change event",
    });
  });

  test("a malformed frame is reported once per frame and refetches everything", async () => {
    const { client, sync, broken, fetched } = setup();
    sync.opened(false);
    sync.receive(resync);
    sync.receive({ event: "change", data: "{oops" });
    await sync.flush();
    expect(broken).toHaveLength(1);
    expect(fetched).toEqual([]);
    expect(invalidated(client, issueKey("AI-1"))).toBe(true);
    expect(invalidated(client, ["issues", { teamKey: "AI" }])).toBe(true);
  });
});

describe("applying changes", () => {
  test("a change this tab made is skipped", async () => {
    const { sync, fetched, invalidatedKeys } = setup();
    sync.receive(change("AI-1", { requestId: "own-1" }));
    await sync.flush();
    expect(fetched).toEqual([]);
    expect(invalidatedKeys()).toEqual([]);
  });

  test("five changes to two issues cost two fetches and at most one list refetch", async () => {
    vi.useFakeTimers();
    const { sync, fetched, listInvalidations, remote } = setup();
    sync.receive(change("AI-1"));
    sync.receive(change("AI-2", { entityType: "comment", action: "created" }));
    sync.receive(change("AI-1", { action: "moved" }));
    sync.receive(change("AI-2", { entityType: "vote", action: "cast" }));
    sync.receive(change("AI-1"));
    expect(fetched).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    expect(fetched.toSorted()).toEqual(["AI-1", "AI-2"]);
    expect(listInvalidations()).toBeLessThanOrEqual(1);
    expect(remote.map(([identifier]) => identifier).toSorted()).toEqual([
      "AI-1",
      "AI-2",
    ]);
  });

  test("a remote change writes the fresh issue to its detail and rows", async () => {
    const { client, sync, invalidatedKeys } = setup();
    client.setQueryData(eventsKey("AI-1"), []);
    sync.receive(change("AI-1"));
    await sync.flush();
    expect(client.getQueryData(issueKey("AI-1"))).toMatchObject({
      title: "Remote AI-1",
      revision: 2,
      comments: [],
    });
    const row = client
      .getQueryData<IssueListData>(["issues", { teamKey: "AI" }])
      ?.pages[0]?.items.find((item) => item.identifier === "AI-1");
    expect(row).toMatchObject({ title: "Remote AI-1" });
    // A row never carries the detail's own fields.
    expect(row).not.toHaveProperty("comments");
    expect(invalidatedKeys()).toContain(JSON.stringify(eventsKey("AI-1")));
  });

  test("a fetch older than the cached copy is dropped", async () => {
    const { client, sync, remote } = setup();
    client.setQueryData(
      issueKey("AI-1"),
      detailFixture(issueFixture(1, { revision: 7, title: "Newer" })),
    );
    sync.receive(change("AI-1"));
    await sync.flush();
    expect(cachedIssue(client, "AI-1")?.title).toBe("Newer");
    expect(remote).toEqual([]);
  });

  test("issues created elsewhere refetch the shown lists once, then are marked", async () => {
    const { sync, fetched, listInvalidations, created } = setup();
    sync.receive(change("AI-20", { action: "created" }));
    sync.receive(change("AI-21", { action: "created" }));
    sync.receive(change("AI-20", { entityType: "label" }));
    await sync.flush();
    expect(fetched).toEqual([]);
    expect(listInvalidations()).toBe(1);
    expect(created).toEqual([["AI-20", "AI-21"]]);
  });

  test("a change to an issue this tab never loaded fetches nothing", async () => {
    const { sync, fetched, listInvalidations } = setup();
    sync.receive(change("AI-99"));
    await sync.flush();
    expect(fetched).toEqual([]);
    expect(listInvalidations()).toBe(0);
  });

  test("a deleted issue is forgotten without a fetch", async () => {
    const { client, sync, fetched } = setup();
    sync.receive(change("AI-1"));
    sync.receive(change("AI-1", { action: "deleted" }));
    await sync.flush();
    expect(fetched).toEqual([]);
    expect(cachedIssue(client, "AI-1")).toBeUndefined();
    expect(client.getQueryData(issueKey("AI-1"))).toBeUndefined();
  });

  test("a catalog change refetches the workspace and no issue", async () => {
    const { client, sync, fetched, invalidatedKeys } = setup();
    sync.receive(
      change(null, {
        entityType: "label",
        actorId: "actor-human:jerred",
      }),
    );
    await sync.flush();
    expect(fetched).toEqual([]);
    expect(invalidatedKeys()).toEqual([JSON.stringify(bootstrapKey)]);
    expect(invalidated(client, bootstrapKey)).toBe(true);
    expect(invalidated(client, issueKey("AI-1"))).toBe(false);
  });

  test("an actor the workspace does not list yet refetches it", async () => {
    const { sync, invalidatedKeys } = setup();
    sync.receive(change("AI-1", { actorId: "actor-agent:new" }));
    await sync.flush();
    expect(invalidatedKeys()).toContain(JSON.stringify(bootstrapKey));
  });
});

describe("resync", () => {
  const openedAt = 100_000;
  function seeded(updatedAt: number) {
    const client = cacheFixture();
    // Every fixture query landed at `updatedAt`.
    for (const query of client.getQueryCache().getAll()) {
      query.setState({ dataUpdatedAt: updatedAt });
    }
    return setup(client, { now: () => openedAt });
  }

  test("the page's first resync leaves data the page load just fetched", async () => {
    const { client, sync } = seeded(openedAt - 500);
    sync.opened(true);
    sync.receive(resync);
    await sync.flush();
    expect(invalidated(client, issueKey("AI-1"))).toBe(false);
    expect(invalidated(client, bootstrapKey)).toBe(false);
  });

  test("the page's first resync refetches data from well before the stream", async () => {
    const { client, sync } = seeded(openedAt - 10_000);
    sync.opened(true);
    sync.receive(resync);
    await sync.flush();
    expect(invalidated(client, issueKey("AI-1"))).toBe(true);
  });

  test("a reconnection refetches everything that predates it", async () => {
    const { client, sync } = seeded(openedAt - 500);
    sync.opened(false);
    sync.receive(resync);
    await sync.flush();
    expect(invalidated(client, issueKey("AI-1"))).toBe(true);
    expect(invalidated(client, ["issues", { teamKey: "AI" }])).toBe(true);
  });

  test("a change in the same window as the opening resync still applies", async () => {
    const { sync, fetched } = seeded(openedAt - 500);
    sync.opened(true);
    sync.receive(resync);
    sync.receive(change("AI-1"));
    await sync.flush();
    expect(fetched).toEqual(["AI-1"]);
  });

  test("a resync mid-stream refetches everything, however new", async () => {
    const { client, sync } = seeded(openedAt + 5000);
    sync.opened(true);
    sync.receive(resync);
    sync.receive(change("AI-1", { requestId: "own-1" }));
    sync.receive(resync);
    await sync.flush();
    expect(invalidated(client, issueKey("AI-1"))).toBe(true);
    expect(invalidated(client, bootstrapKey)).toBe(true);
  });
});
