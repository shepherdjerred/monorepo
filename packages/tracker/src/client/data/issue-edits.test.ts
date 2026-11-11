import { describe, expect, test, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Issue, IssueDetailData } from "./api.ts";
import { cachedIssue, issueKey, type IssueListData } from "./cache.ts";
import { inverseChange } from "./issue-changes.ts";
import { createIssueEdits, type IssueApi } from "./issue-edits.ts";
import {
  cacheFixture,
  cacheSnapshot,
  detailFixture,
  issueFixture,
  workspaceFixture,
} from "./testing.ts";

class Conflict extends Error {
  readonly data = { code: "CONFLICT" };
}

type Update = Parameters<IssueApi["update"]>[0];

/**
 * A server holding `AI-1`. It checks revisions as the real one does, and each
 * call waits for its turn so a test decides when a response arrives.
 */
function fakeServer(initial: Issue = issueFixture(1)) {
  let stored = initial;
  const updates: Update[] = [];
  const removed: { expectedRevision: number; keepalive: boolean }[] = [];
  const gates: (() => void)[] = [];
  let held = false;
  const turn = () =>
    held
      ? new Promise<void>((resolve) => {
          gates.push(resolve);
        })
      : Promise.resolve();
  function guard(expectedRevision: number) {
    if (expectedRevision !== stored.revision) {
      throw new Conflict("This issue changed. Reload before saving.");
    }
  }
  const api: IssueApi = {
    update: async (input) => {
      updates.push(input);
      await turn();
      guard(input.expectedRevision);
      const state =
        workspaceFixture.states.find(({ name }) => name === input.stateName) ??
        stored.state;
      stored = {
        ...stored,
        state,
        stateId: state.id,
        priority: input.priority ?? stored.priority,
        title: input.title ?? stored.title,
        description: input.description ?? stored.description,
        revision: stored.revision + 1,
      };
      return stored;
    },
    move: async () => stored,
    vote: async (_identifier, voted) => {
      await turn();
      stored = { ...stored, voteCount: voted ? 1 : 0 };
      return { voteCount: stored.voteCount, viewerVoted: voted };
    },
    detail: async () => detailFixture(stored),
    remove: async (input, keepalive) => {
      removed.push({ expectedRevision: input.expectedRevision, keepalive });
      await turn();
      guard(input.expectedRevision);
      return { deleted: true };
    },
  };
  return {
    api,
    updates,
    removed,
    get stored() {
      return stored;
    },
    /** Someone else edits the issue behind this client's back. */
    editElsewhere(change: Partial<Issue>) {
      stored = { ...stored, ...change, revision: stored.revision + 1 };
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      for (const open of gates.splice(0)) {
        open();
      }
    },
  };
}

function setup(server = fakeServer()) {
  const client = cacheFixture();
  const errors: string[] = [];
  const edits = createIssueEdits({
    client,
    api: server.api,
    onError: (message) => {
      errors.push(message);
    },
  });
  return { client, edits, errors, server };
}

const detail = (client: QueryClient) =>
  client.getQueryData<IssueDetailData>(issueKey("AI-1"));
const rows = (client: QueryClient) =>
  client
    .getQueriesData<IssueListData>({ queryKey: ["issues"] })
    .flatMap(([, data]) => data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((row) => row.identifier === "AI-1");

describe("optimistic issue edits", () => {
  test("an edit shows on the detail and every cached list row before the server answers", async () => {
    const { client, edits, server } = setup();
    server.hold();
    const saving = edits.edit("AI-1", {
      kind: "state",
      stateName: "In progress",
    });
    expect(detail(client)?.state.name).toBe("In progress");
    expect(rows(client).map((row) => row.state.name)).toEqual([
      "In progress",
      "In progress",
    ]);
    // The other issues in those pages are untouched.
    expect(cachedIssue(client, "AI-2")?.state.name).toBe("Todo");
    server.release();
    expect(await saving).toEqual({ ok: true, value: undefined });
    expect(detail(client)?.revision).toBe(2);
    expect(rows(client).map((row) => row.revision)).toEqual([2, 2]);
  });

  test("a failed edit puts every copy back exactly and reports it", async () => {
    const { client, edits, errors, server } = setup();
    const before = cacheSnapshot(client);
    server.api.update = async () => {
      throw new Error("Tracker writes are paused");
    };
    const outcome = await edits.edit("AI-1", { kind: "priority", priority: 1 });
    expect(outcome.ok).toBe(false);
    expect(cacheSnapshot(client)).toEqual(before);
    expect(errors).toEqual(["AI-1: Tracker writes are paused"]);
  });

  test("a stale revision reloads the issue and retries once", async () => {
    const { client, edits, errors, server } = setup();
    server.editElsewhere({ title: "Renamed elsewhere" });
    const outcome = await edits.edit("AI-1", { kind: "priority", priority: 2 });
    expect(outcome.ok).toBe(true);
    expect(server.updates.map((input) => input.expectedRevision)).toEqual([
      1, 2,
    ]);
    expect(errors).toEqual([]);
    expect(detail(client)).toMatchObject({
      priority: 2,
      title: "Renamed elsewhere",
      revision: 3,
    });
  });

  test("a second conflict rolls back and says someone else changed the issue", async () => {
    const { client, edits, errors, server } = setup();
    server.api.update = async (input) => {
      server.updates.push(input);
      throw new Conflict("This issue changed. Reload before saving.");
    };
    const outcome = await edits.edit("AI-1", { kind: "priority", priority: 2 });
    expect(outcome.ok).toBe(false);
    expect(server.updates).toHaveLength(2);
    expect(detail(client)?.priority).toBe(0);
    expect(rows(client).map((row) => row.priority)).toEqual([0, 0]);
    expect(errors).toEqual([
      "AI-1 was changed by someone else, so your edit was not saved. Review it and try again.",
    ]);
  });

  test("a description is never resent over someone else's edit", async () => {
    const { client, edits, server } = setup();
    server.editElsewhere({ description: "Theirs" });
    const outcome = await edits.edit("AI-1", {
      kind: "description",
      description: "Mine",
      attachmentIds: [],
    });
    expect(outcome.ok).toBe(false);
    expect(server.updates).toHaveLength(1);
    expect(server.stored.description).toBe("Theirs");
    expect(detail(client)?.description).toBe("");
  });

  test("two quick edits are sent in order, the second on the first's revision", async () => {
    const { client, edits, errors, server } = setup();
    server.hold();
    const first = edits.edit("AI-1", { kind: "state", stateName: "Done" });
    const second = edits.edit("AI-1", { kind: "priority", priority: 3 });
    // Both show at once, and only the first has been sent.
    expect(detail(client)).toMatchObject({
      priority: 3,
      state: { name: "Done" },
    });
    await vi.waitFor(() => {
      expect(server.updates).toHaveLength(1);
    });
    server.release();
    await first;
    // The first answer carries the old priority; the pending edit still shows.
    expect(detail(client)?.priority).toBe(3);
    expect(await second).toEqual({ ok: true, value: undefined });
    expect(server.updates.map((input) => input.expectedRevision)).toEqual([
      1, 2,
    ]);
    expect(errors).toEqual([]);
    expect(server.stored).toMatchObject({
      priority: 3,
      state: { name: "Done" },
      revision: 3,
    });
    expect(rows(client).map((row) => [row.priority, row.revision])).toEqual([
      [3, 3],
      [3, 3],
    ]);
  });

  test("a failed edit does not take a later pending edit down with it", async () => {
    const { client, edits, server } = setup();
    server.hold();
    const realUpdate = server.api.update;
    server.api.update = async (input) => {
      if (input.stateName !== undefined) {
        throw new Error("Unknown workflow state for this team");
      }
      return realUpdate(input);
    };
    const first = edits.edit("AI-1", { kind: "state", stateName: "Done" });
    const second = edits.edit("AI-1", { kind: "priority", priority: 4 });
    server.release();
    const firstOutcome = await first;
    expect(firstOutcome.ok).toBe(false);
    expect(detail(client)).toMatchObject({
      priority: 4,
      state: { name: "Todo" },
    });
    const secondOutcome = await second;
    expect(secondOutcome.ok).toBe(true);
    expect(detail(client)).toMatchObject({
      priority: 4,
      state: { name: "Todo" },
    });
  });

  test("a refetch that lands mid-edit keeps the pending edit on screen", async () => {
    const { client, edits, server } = setup();
    server.hold();
    const saving = edits.edit("AI-1", { kind: "priority", priority: 1 });
    await client.query({
      queryKey: issueKey("AI-1"),
      queryFn: () => detailFixture(issueFixture(1)),
      staleTime: 0,
    });
    expect(detail(client)?.priority).toBe(1);
    server.release();
    await saving;
  });

  test("a vote counts at once and settles on the server's count", async () => {
    const { client, edits, server } = setup();
    server.hold();
    const saving = edits.edit("AI-1", { kind: "vote", voted: true });
    expect(detail(client)).toMatchObject({ voteCount: 1, viewerVoted: true });
    expect(rows(client).map((row) => row.voteCount)).toEqual([1, 1]);
    // A list row carries no viewer state of its own.
    expect(rows(client).every((row) => !("viewerVoted" in row))).toBe(true);
    server.release();
    const savingOutcome = await saving;
    expect(savingOutcome.ok).toBe(true);
    expect(detail(client)).toMatchObject({ voteCount: 1, viewerVoted: true });
  });

  test("undo sends the inverse edit and restores the previous value", async () => {
    const { client, edits, server } = setup();
    const before = cachedIssue(client, "AI-1");
    if (before === undefined) {
      throw new Error("AI-1 is not cached");
    }
    const change = { kind: "state", stateName: "Done" } as const;
    const inverse = inverseChange(before, change);
    expect(inverse).toEqual({ kind: "state", stateName: "Todo" });
    await edits.edit("AI-1", change);
    expect(server.stored.state.name).toBe("Done");
    if (inverse === undefined) {
      throw new Error("A state change can be undone");
    }
    await edits.edit("AI-1", inverse);
    expect(server.stored.state.name).toBe("Todo");
    expect(detail(client)?.state.name).toBe("Todo");
    expect(rows(client).map((row) => row.state.name)).toEqual(["Todo", "Todo"]);
  });
});

describe("deferred issue delete", () => {
  test("a requested delete only hides the issue; cancelling shows it again", () => {
    const { edits, server } = setup();
    edits.requestDelete("AI-1");
    expect([...edits.hidden.get()]).toEqual(["AI-1"]);
    expect(edits.cancelDelete("AI-1")).toBe(true);
    expect([...edits.hidden.get()]).toEqual([]);
    expect(server.removed).toEqual([]);
  });

  test("committing sends the delete and drops the issue from the cache", async () => {
    const { client, edits, server } = setup();
    edits.requestDelete("AI-1");
    const committed = await edits.commitDelete("AI-1");
    expect(committed.ok).toBe(true);
    expect(server.removed).toEqual([{ expectedRevision: 1, keepalive: false }]);
    expect(detail(client)).toBeUndefined();
    expect(rows(client)).toEqual([]);
    expect([...edits.hidden.get()]).toEqual([]);
    // Nothing is left to cancel or send twice.
    expect(edits.cancelDelete("AI-1")).toBe(false);
    await edits.commitDelete("AI-1");
    expect(server.removed).toHaveLength(1);
  });

  test("a cancelled delete is never sent", async () => {
    const { edits, server } = setup();
    edits.requestDelete("AI-1");
    edits.cancelDelete("AI-1");
    await edits.commitDelete("AI-1");
    expect(server.removed).toEqual([]);
  });

  test("a delete waits for edits still saving and uses their revision", async () => {
    const { edits, server } = setup();
    server.hold();
    const saving = edits.edit("AI-1", { kind: "priority", priority: 1 });
    edits.requestDelete("AI-1");
    const deleting = edits.commitDelete("AI-1");
    server.release();
    await saving;
    server.release();
    const deletingOutcome = await deleting;
    expect(deletingOutcome.ok).toBe(true);
    expect(server.removed).toEqual([{ expectedRevision: 2, keepalive: false }]);
  });

  test("a refused delete shows the issue again and reports it", async () => {
    const { client, edits, errors, server } = setup();
    server.api.remove = async () => {
      throw new Error("Tracker writes are paused");
    };
    edits.requestDelete("AI-1");
    const committed = await edits.commitDelete("AI-1");
    expect(committed.ok).toBe(false);
    expect([...edits.hidden.get()]).toEqual([]);
    expect(rows(client)).toHaveLength(2);
    expect(errors).toEqual(["AI-1: Tracker writes are paused"]);
  });

  test("leaving the page sends every waiting delete in a request that outlives it", async () => {
    const { edits, server } = setup();
    edits.requestDelete("AI-1");
    edits.flushDeletes();
    expect(server.removed).toEqual([{ expectedRevision: 1, keepalive: true }]);
    // The toast expiring afterwards must not send it again.
    await edits.commitDelete("AI-1");
    expect(server.removed).toHaveLength(1);
  });
});
