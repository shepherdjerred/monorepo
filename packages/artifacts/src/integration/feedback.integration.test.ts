import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HttpError,
  agentHeaders,
  createClient,
  humanHeaders,
  publish,
  type TestClient,
} from "#testing/client.ts";
import { createMigratedDatabase } from "#testing/database.ts";
import { openEventStream } from "#testing/sse.ts";
import { createTestRuntime, type TestRuntime } from "#testing/runtime.ts";

const ThreadView = z.object({
  id: z.string(),
  state: z.string(),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      delivery: z
        .object({
          state: z.string(),
          attempts: z.number(),
          actor: z.object({ name: z.string() }).nullable(),
        })
        .nullable(),
      editableUntil: z.string().nullable(),
    }),
  ),
});
const Claim = z.object({
  items: z.array(
    z.object({
      attempt: z.number(),
      comment: z.object({ id: z.string(), body: z.string() }),
      thread: z.object({
        id: z.string(),
        priorComments: z.array(z.object({ body: z.string() })),
      }),
      artifact: z
        .object({
          commentedOnVersion: z.number().nullable(),
          currentVersion: z.number(),
        })
        .nullable(),
      reviewUrl: z.string(),
    }),
  ),
  nextDeliverableAt: z.string().nullable(),
});

let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
let fast: TestRuntime;
let slow: TestRuntime;
let human: TestClient;
let humanSlow: TestClient;

const WORKSPACE = "karpathy:/work/feedback";
const make = (runtime: TestRuntime, name: string, workspace = WORKSPACE) =>
  createClient(runtime, agentHeaders(name, workspace));

beforeAll(async () => {
  database = await createMigratedDatabase();
  const shared = {
    db: database.db,
    databaseUrl: database.url,
    heartbeatMs: 40,
  };
  fast = await createTestRuntime({
    ...shared,
    flagValues: { "artifacts-feedback-settle-seconds": 0 },
  });
  slow = await createTestRuntime({
    ...shared,
    flagValues: { "artifacts-feedback-settle-seconds": 600 },
  });
  human = createClient(fast, humanHeaders());
  humanSlow = createClient(slow, humanHeaders());
});
afterAll(async () => {
  await database.close();
});

let counter = 0;
/** An artifact published from WORKSPACE on its own board. */
async function scenario(workspace = WORKSPACE) {
  counter += 1;
  const slug = `fb-${String(counter)}`;
  const publisher = make(fast, `publisher-${slug}`, workspace);
  const { committed } = await publish(
    publisher,
    {
      "index.html": {
        body: `<p>${slug} ${crypto.randomUUID()}</p>`,
        mediaType: "text/html",
      },
    },
    { board: slug },
  );
  return { slug, ...committed };
}

async function comment(
  client: TestClient,
  scene: { slug: string; artifactId: string; versionId: string },
  body: string,
) {
  return ThreadView.parse(
    await client.mutate("threads.create", {
      board: scene.slug,
      artifactId: scene.artifactId,
      versionId: scene.versionId,
      anchor: { type: "frame", x: 0.5, y: 0.25 },
      body,
    }),
  );
}

const claimItems = async (client: TestClient, scope?: unknown) => {
  const response = await claim(client, scope);
  return response.items;
};

const claim = async (client: TestClient, scope?: unknown) =>
  Claim.parse(
    await client.mutate("feedback.claim", scope === undefined ? {} : { scope }),
  );

async function expectStatus(work: Promise<unknown>, status: number) {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpError) {
      expect(error.status).toBe(status);
      return;
    }
    throw error;
  }
  throw new Error(`expected HTTP ${String(status)}`);
}

describe("delivery", () => {
  it("holds a comment for the settle window and lets its author edit or delete it", async () => {
    const scene = await scenario();
    const thread = await comment(humanSlow, scene, "first draft");
    const first = thread.comments[0];
    expect(first?.editableUntil).not.toBeNull();
    const waiting = Claim.parse(
      await make(slow, "waiter").mutate("feedback.claim", {}),
    );
    expect(waiting.items).toEqual([]);
    expect(waiting.nextDeliverableAt).not.toBeNull();
    const edited = ThreadView.parse(
      await humanSlow.mutate("threads.editComment", {
        commentId: first?.id,
        body: "second draft",
      }),
    );
    expect(edited.comments[0]?.body).toBe("second draft");
    // A runtime with no settle window delivers it; from then on it is locked.
    const delivered = await claim(make(fast, "taker"));
    expect(delivered.items.map((item) => item.comment.body)).toContain(
      "second draft",
    );
    await expectStatus(
      humanSlow.mutate("threads.editComment", {
        commentId: first?.id,
        body: "too late",
      }),
      403,
    );
    await expectStatus(
      humanSlow.mutate("threads.deleteComment", { commentId: first?.id }),
      403,
    );
  });

  it("deletes a lone comment and its thread inside the window", async () => {
    const scene = await scenario();
    const thread = await comment(humanSlow, scene, "never mind");
    const gone = await humanSlow.mutate("threads.deleteComment", {
      commentId: thread.comments[0]?.id,
    });
    expect(gone).toBeNull();
    expect(
      Claim.parse(await make(fast, "nobody").mutate("feedback.claim", {}))
        .items,
    ).toEqual([]);
  });

  it("delivers a comment once, retries it to the same actor until acknowledged, then never again", async () => {
    const scene = await scenario();
    await comment(human, scene, "needs a bigger title");
    const agent = make(fast, "reader");
    const first = await claim(agent);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      attempt: 1,
      artifact: { commentedOnVersion: 1, currentVersion: 1 },
      reviewUrl: `https://app.example.test/a/${scene.artifactId}`,
    });
    expect(first.items[0]?.thread.priorComments).toEqual([]);
    // Printed but not acknowledged: the same actor gets it again.
    const retry = await claim(agent);
    expect(retry.items).toHaveLength(1);
    expect(retry.items[0]?.attempt).toBe(2);
    // A different live actor in the same workspace does not take it.
    expect(await claimItems(make(fast, "other"))).toEqual([]);
    const acked = z.object({ acked: z.number() }).parse(
      await agent.mutate("feedback.ack", {
        commentIds: [first.items[0]?.comment.id],
      }),
    );
    expect(acked.acked).toBe(1);
    expect(await claimItems(agent)).toEqual([]);
    // A later comment is the only thing the next wait returns.
    await comment(human, scene, "and the footer");
    const next = await claim(agent);
    expect(next.items.map((item) => item.comment.body)).toEqual([
      "and the footer",
    ]);
  });

  it("lets a new session take over comments held by an actor not seen for 15 minutes", async () => {
    const scene = await scenario();
    await comment(human, scene, "orphaned note");
    const dead = make(fast, "dead-session");
    expect(await claimItems(dead)).toHaveLength(1);
    await database.db.actor.update({
      where: { key: "agent:dead-session" },
      data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) },
    });
    const resumed = make(fast, "resumed-session");
    const taken = await claim(resumed);
    expect(taken.items.map((item) => item.comment.body)).toEqual([
      "orphaned note",
    ]);
    expect(taken.items[0]?.attempt).toBe(2);
    // The old session is alive again, but the comment is now held by a live actor.
    expect(await claimItems(dead)).toEqual([]);
  });

  it("never hands one comment to two concurrent claimers", async () => {
    const scene = await scenario();
    const bodies = Array.from(
      { length: 12 },
      (_value, index) => `note ${String(index)}`,
    );
    for (const body of bodies) await comment(human, scene, body);
    const claimers = Array.from({ length: 6 }, (_value, index) =>
      make(fast, `racer-${String(index)}`),
    );
    const rounds = await Promise.all(claimers.map((client) => claim(client)));
    const delivered = rounds.flatMap((round) =>
      round.items.map((item) => item.comment.body),
    );
    expect(delivered.toSorted()).toEqual(bodies.toSorted());
    expect(new Set(delivered).size).toBe(delivered.length);
  });

  it("scopes a bare claim to the caller's own workspace and honors board and artifact scopes", async () => {
    const mine = await scenario(WORKSPACE);
    const theirs = await scenario("elsewhere:/other/tree");
    await comment(human, mine, "for me");
    await comment(human, theirs, "for them");
    const reader = make(fast, "scoped");
    const mineItems = await claimItems(reader);
    expect(mineItems.map((item) => item.comment.body)).toEqual(["for me"]);
    const byBoard = await claim(make(fast, "board-reader"), {
      type: "board",
      board: theirs.slug,
    });
    expect(byBoard.items.map((item) => item.comment.body)).toEqual([
      "for them",
    ]);
    await comment(human, theirs, "more for them");
    const byArtifact = await claim(make(fast, "artifact-reader"), {
      type: "artifact",
      artifactId: theirs.artifactId,
    });
    expect(byArtifact.items.map((item) => item.comment.body)).toEqual([
      "more for them",
    ]);
  });

  it("includes board-level threads on boards holding the caller's artifacts", async () => {
    const scene = await scenario("pins:/work/board");
    const thread = z.object({ id: z.string() }).parse(
      await human.mutate("threads.create", {
        board: scene.slug,
        anchor: { type: "board", page: 0, x: 10, y: 20 },
        body: "whole board note",
      }),
    );
    expect(thread.id).toBeTruthy();
    const items = await claim(make(fast, "board-owner", "pins:/work/board"));
    expect(items.items.map((item) => item.comment.body)).toEqual([
      "whole board note",
    ]);
    expect(items.items[0]?.artifact).toBeNull();
    expect(items.items[0]?.reviewUrl).toBe(
      `https://app.example.test/b/${scene.slug}`,
    );
  });
});

describe("replies", () => {
  it("marks delivered comments handled on reply, and leaves an unseen comment deliverable", async () => {
    const scene = await scenario();
    const first = await comment(human, scene, "first");
    const agent = make(fast, "replier");
    await claim(agent);
    // A second comment lands on the same thread after the claim, before the reply.
    await human.mutate("threads.reply", {
      threadId: first.id,
      body: "second, unseen",
    });
    const replied = ThreadView.parse(
      await agent.mutate("threads.reply", {
        threadId: first.id,
        body: "on it",
        resolve: false,
      }),
    );
    const states = replied.comments.map(
      (entry) => entry.delivery?.state ?? "agent",
    );
    expect(states).toEqual(["handled", "queued", "agent"]);
    const next = await claim(agent);
    expect(next.items.map((item) => item.comment.body)).toEqual([
      "second, unseen",
    ]);
    expect(
      next.items[0]?.thread.priorComments.map((entry) => entry.body),
    ).toEqual(["first"]);
  });

  it("resolves with a reply and stops delivery; reopening makes held comments deliverable", async () => {
    const scene = await scenario();
    const thread = await comment(human, scene, "please fix");
    const agent = make(fast, "resolver");
    await claim(agent);
    const resolved = ThreadView.parse(
      await agent.mutate("threads.reply", {
        threadId: thread.id,
        body: "fixed in v2",
        resolve: true,
      }),
    );
    expect(resolved.state).toBe("resolved");
    expect(await claimItems(agent)).toEqual([]);
    const lonely = await comment(human, scene, "resolved soon");
    await human.mutate("threads.resolve", { threadId: lonely.id });
    expect(await claimItems(agent)).toEqual([]);
    await human.mutate("threads.reopen", { threadId: lonely.id });
    const reopened = await claimItems(agent);
    expect(reopened.map((item) => item.comment.body)).toEqual([
      "resolved soon",
    ]);
  });

  it("redelivers a comment a person sends again", async () => {
    const scene = await scenario();
    const thread = await comment(human, scene, "send me twice");
    const agent = make(fast, "twice");
    const first = await claim(agent);
    await agent.mutate("feedback.ack", {
      commentIds: [first.items[0]?.comment.id],
    });
    expect(await claimItems(agent)).toEqual([]);
    await human.mutate("feedback.redeliver", {
      commentId: thread.comments[0]?.id,
    });
    expect(await claimItems(agent)).toHaveLength(1);
  });

  it("reports pending feedback without taking it", async () => {
    const scene = await scenario();
    await comment(human, scene, "pending one");
    const agent = make(fast, "peeker");
    const pending = z
      .object({ deliverable: z.number(), settling: z.number() })
      .parse(await agent.query("feedback.pending", {}));
    expect(pending.deliverable).toBe(1);
    expect(await claimItems(agent)).toHaveLength(1);
  });
});

describe("live streams", () => {
  it("wakes a waiting agent over SSE, with ids only and a heartbeat", async () => {
    const scene = await scenario();
    const agent = make(fast, "streamer");
    const waiter = openEventStream(
      await fast.call("app", `/api/feedback/stream?board=${scene.slug}`, {
        headers: agentHeaders("streamer"),
      }),
    );
    const ready = await waiter.waitFor((events) =>
      events.some((entry) => entry.event === "ready"),
    );
    expect(ready.raw).toContain("retry: 3000");
    expect(JSON.parse(ready.events[0]?.data ?? "{}")).toMatchObject({
      type: "ready",
      pending: 0,
      scope: { type: "board", board: scene.slug },
    });

    const waiters = z
      .object({
        waiters: z.array(z.object({ actor: z.object({ name: z.string() }) })),
      })
      .parse(await human.query("feedback.waiters", { board: scene.slug }));
    expect(waiters.waiters.map((entry) => entry.actor.name)).toEqual([
      "streamer",
    ]);

    const detail = z
      .object({ contentUrl: z.string() })
      .parse(await human.query("versions.get", { id: scene.versionId }));
    const token = detail.contentUrl.split("/_t/")[1]?.replace("/", "") ?? "";
    expect(token.length).toBeGreaterThan(16);
    const thread = await comment(human, scene, "wake up");
    const wake = await waiter.waitFor((events) =>
      events.some((entry) => entry.event === "feedback"),
    );
    const feedback: unknown = JSON.parse(
      wake.events.find((entry) => entry.event === "feedback")?.data ?? "{}",
    );
    expect(feedback).toMatchObject({
      type: "feedback",
      threadId: thread.id,
      commentId: thread.comments[0]?.id,
    });
    expect(
      Object.keys(z.record(z.string(), z.unknown()).parse(feedback)).toSorted(),
    ).toEqual([
      "artifactId",
      "boardId",
      "commentId",
      "deliverableAt",
      "threadId",
      "type",
    ]);
    expect(wake.raw).not.toContain(token);
    expect(wake.raw).not.toContain("wake up");

    const beat = await waiter.waitFor(
      (_events, raw) => raw.includes(": heartbeat"),
      2000,
    );
    expect(beat.raw).toContain(": heartbeat");
    await waiter.cancel();
    expect(await claimItems(agent)).toHaveLength(1);
  });

  it("drops a waiter from the registry when its stream closes", async () => {
    const scene = await scenario();
    const waiter = openEventStream(
      await fast.call("app", `/api/feedback/stream?board=${scene.slug}`, {
        headers: agentHeaders("short-lived"),
      }),
    );
    await waiter.waitFor((events) =>
      events.some((entry) => entry.event === "ready"),
    );
    expect(fast.services.waiters.count()).toBeGreaterThan(0);
    await waiter.cancel();
    const deadline = Date.now() + 3000;
    while (
      fast.services.waiters
        .all()
        .some((entry) => entry.actor.name === "short-lived") &&
      Date.now() < deadline
    )
      await Bun.sleep(25);
    expect(
      fast.services.waiters
        .all()
        .some((entry) => entry.actor.name === "short-lived"),
    ).toBe(false);
  });

  it("tells a waiter its artifact is gone", async () => {
    const scene = await scenario();
    const stream = openEventStream(
      await fast.call(
        "app",
        `/api/feedback/stream?artifact=${scene.artifactId}`,
        { headers: agentHeaders("gone-waiter") },
      ),
    );
    await stream.waitFor((events) =>
      events.some((entry) => entry.event === "ready"),
    );
    await human.mutate("artifacts.delete", { id: scene.artifactId });
    const gone = await stream.waitFor((events) =>
      events.some((entry) => entry.event === "gone"),
    );
    expect(gone.events.some((entry) => entry.event === "gone")).toBe(true);
    await stream.cancel();
  });

  it("streams board changes to the UI as ids and revisions", async () => {
    const scene = await scenario();
    const stream = openEventStream(
      await fast.call("app", `/api/events/stream?board=${scene.slug}`, {
        headers: humanHeaders(),
      }),
    );
    const first = await stream.waitFor((events) => events.length > 0);
    expect(first.events[0]?.event).toBe("resync");
    await human.mutate("boards.applyOps", {
      slug: scene.slug,
      ops: [
        {
          op: "moveFrames",
          moves: [{ artifactId: scene.artifactId, x: 500, y: 40 }],
        },
      ],
    });
    const changed = await stream.waitFor((events) =>
      events.some((entry) => entry.event === "board"),
    );
    const board: unknown = JSON.parse(
      changed.events.find((entry) => entry.event === "board")?.data ?? "{}",
    );
    expect(board).toMatchObject({
      type: "board",
      revision: expect.any(Number),
    });
    expect(changed.raw).not.toMatch(/_t\//u);
    await stream.cancel();
  });

  it("rejects a stream for a board that does not exist", async () => {
    const response = await fast.call(
      "app",
      "/api/feedback/stream?board=no-such-board",
      {
        headers: agentHeaders("lost"),
      },
    );
    expect(response.status).toBe(404);
  });
});
