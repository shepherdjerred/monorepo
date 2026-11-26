import { expect, test } from "vitest";
import type {
  FeedbackClaimResponse,
  LiveMessage,
} from "@shepherdjerred/artifacts/contract";
import { ArtifactsCliError } from "#lib/artifacts/errors.ts";
import type { LiveEvent } from "#lib/artifacts/live.ts";
import {
  backoffDelay,
  waitForFeedback,
  type WaitDeps,
  type WaitOptions,
} from "#lib/artifacts/wait.ts";
import { feedbackItem, IDS } from "#test/support/artifacts.ts";

const EMPTY: FeedbackClaimResponse = { items: [], nextDeliverableAt: null };
const WITH_ITEM: FeedbackClaimResponse = {
  items: [feedbackItem()],
  nextDeliverableAt: null,
};
const FAST: WaitOptions = {
  backoff: { baseMs: 5, maxMs: 20 },
  random: () => 1,
  pollMs: 10_000,
  connectGraceMs: 200,
  ackRetryMs: 1,
};
const READY: LiveMessage = {
  type: "ready",
  scope: { type: "owner", ownerKey: "k" },
  pending: 0,
};
const FEEDBACK: LiveMessage = {
  type: "feedback",
  boardId: IDS.board,
  artifactId: IDS.artifact,
  threadId: IDS.thread,
  commentId: IDS.comment,
  deliverableAt: "2026-11-26T10:00:10.000Z",
};

/** One stream connection the test drives by hand. */
function connection(signal: AbortSignal) {
  const queue: (LiveEvent | { fail: unknown } | { end: true })[] = [];
  let wake: (() => void) | null = null;
  const push = (entry: (typeof queue)[number]) => {
    queue.push(entry);
    wake?.();
  };
  async function* events(): AsyncGenerator<LiveEvent> {
    for (;;) {
      signal.throwIfAborted();
      const next = queue.shift();
      if (next === undefined) {
        await new Promise<void>((resolve, reject) => {
          wake = resolve;
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
        wake = null;
        continue;
      }
      if ("fail" in next) throw next.fail;
      if ("end" in next) return;
      yield next;
    }
  }
  return {
    events: events(),
    open: () => push({ type: "open" }),
    message: (message: LiveMessage) => push({ type: "message", message }),
    fail: (error: unknown) => push({ fail: error }),
    end: () => push({ end: true }),
  };
}

type Harness = ReturnType<typeof harness>;

function harness(script: {
  claims: (FeedbackClaimResponse | Error)[];
  /** Called for each stream connection, in order. */
  onConnect?: (conn: ReturnType<typeof connection>, index: number) => void;
  present?: () => Promise<void>;
  ack?: () => Promise<void>;
}) {
  const log: string[] = [];
  const connections: ReturnType<typeof connection>[] = [];
  const claims = [...script.claims];
  const deps: WaitDeps = {
    claim: () => {
      log.push("claim");
      const next = claims.length > 1 ? claims.shift() : claims[0];
      if (next === undefined) throw new Error("no more claims scripted");
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    },
    ack: async (ids) => {
      log.push(`ack:${ids.join(",")}`);
      await script.ack?.();
    },
    stream: (signal) => {
      log.push("stream");
      const conn = connection(signal);
      connections.push(conn);
      script.onConnect?.(conn, connections.length - 1);
      return conn.events;
    },
    present: async (items) => {
      log.push(`present:${String(items.length)}`);
      await script.present?.();
      log.push("presented");
    },
  };
  return { log, deps, connections };
}

function noop(): void {
  // Replaced once the promise it releases exists.
}

const transient = () => new ArtifactsCliError("unreachable", "down");

test("the stream is subscribed before the first claim", async () => {
  const h = harness({
    claims: [WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const result = await waitForFeedback(h.deps, FAST);
  expect(result.outcome).toBe("feedback");
  expect(h.log.slice(0, 2)).toEqual(["stream", "claim"]);
});

test("items are presented first and acknowledged only after the output is flushed", async () => {
  let release: () => void = noop;
  const flushed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({
    claims: [WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
    present: () => flushed,
  });
  const running = waitForFeedback(h.deps, FAST);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(h.log).toContain("present:1");
  expect(h.log.some((line) => line.startsWith("ack:"))).toBe(false);
  release();
  const result = await running;
  expect(h.log.slice(-3)).toEqual([
    "present:1",
    "presented",
    `ack:${IDS.comment}`,
  ]);
  expect(result).toMatchObject({ outcome: "feedback" });
});

test("it blocks on an empty claim and returns when a feedback event arrives", async () => {
  const h = harness({
    claims: [EMPTY, WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const state = { settled: false };
  const running = (async () => {
    const result = await waitForFeedback(h.deps, FAST);
    state.settled = true;
    return result;
  })();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(state.settled).toBe(false);
  expect(
    h.log.filter((line) => line === "claim").length,
  ).toBeGreaterThanOrEqual(1);
  h.connections[0]?.message(FEEDBACK);
  const result = await running;
  expect(result.outcome).toBe("feedback");
});

test("a lost event only delays delivery: the poll claims again", async () => {
  const h = harness({
    claims: [EMPTY, WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const result = await waitForFeedback(h.deps, { ...FAST, pollMs: 40 });
  expect(result.outcome).toBe("feedback");
});

test("a comment still settling is claimed when its window ends", async () => {
  const soon = new Date(Date.now() + 120).toISOString();
  const h = harness({
    claims: [{ items: [], nextDeliverableAt: soon }, WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const started = Date.now();
  const result = await waitForFeedback(h.deps, { ...FAST, pollMs: 10_000 });
  expect(result.outcome).toBe("feedback");
  expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a dropped stream reconnects with backoff and claims again each time", async () => {
  const reconnects: number[] = [];
  const h = harness({
    claims: [EMPTY, EMPTY, WITH_ITEM],
    onConnect: (conn, index) => {
      if (index === 0) {
        conn.open();
        conn.end();
      } else if (index === 1) conn.fail(transient());
      else conn.open();
    },
  });
  const running = waitForFeedback(
    {
      ...h.deps,
      reconnecting: (_error, delay) => {
        reconnects.push(delay);
      },
    },
    FAST,
  );
  // Wait for the third connection, then let the last claim return the item.
  await new Promise((resolve) => setTimeout(resolve, 150));
  h.connections[2]?.message(READY);
  const result = await running;
  expect(result.outcome).toBe("feedback");
  expect(h.connections.length).toBeGreaterThanOrEqual(3);
  expect(
    h.log.filter((line) => line === "claim").length,
  ).toBeGreaterThanOrEqual(3);
  expect(reconnects.length).toBeGreaterThanOrEqual(2);
  for (const delay of reconnects) expect(delay).toBeLessThanOrEqual(20);
});

test("a dropped stream never ends the wait", async () => {
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.open();
      conn.fail(new TypeError("network connection lost"));
    },
  });
  const outcome = await waitForFeedback(h.deps, { ...FAST, timeoutMs: 120 });
  expect(outcome.outcome).toBe("timeout");
  expect(h.connections.length).toBeGreaterThan(2);
});

test("a stream refused for good ends the wait with that error", async () => {
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.fail(new ArtifactsCliError("forbidden", "not an operator"));
    },
  });
  await expect(waitForFeedback(h.deps, FAST)).rejects.toThrow(
    /not an operator/u,
  );
});

test("a gone message ends the wait as gone", async () => {
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.open();
      conn.message({ type: "gone" });
    },
  });
  const result = await waitForFeedback(h.deps, FAST);
  expect(result.outcome).toBe("gone");
  expect(h.log.some((line) => line.startsWith("ack:"))).toBe(false);
});

test("a missing board is gone only when a scope was named", async () => {
  const missing = new ArtifactsCliError("not-found", "no such board");
  const named = harness({
    claims: [missing],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const namedResult = await waitForFeedback(named.deps, {
    ...FAST,
    notFoundIsGone: true,
  });
  expect(namedResult.outcome).toBe("gone");
  const bare = harness({
    claims: [missing],
    onConnect: (conn) => {
      conn.open();
    },
  });
  await expect(waitForFeedback(bare.deps, FAST)).rejects.toThrow(
    /no such board/u,
  );
});

test("the deadline is a timeout outcome, not an error, and acknowledges nothing", async () => {
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const result = await waitForFeedback(h.deps, { ...FAST, timeoutMs: 60 });
  expect(result).toEqual({ outcome: "timeout" });
  expect(h.log.some((line) => line.startsWith("ack:"))).toBe(false);
  expect(h.log).not.toContain("present:1");
});

test("an aborted signal is an interrupted outcome", async () => {
  const controller = new AbortController();
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const running = waitForFeedback(h.deps, {
    ...FAST,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  expect(await running).toEqual({ outcome: "interrupted" });
});

test("unreachable at the first claim is an error; later blips are retried", async () => {
  const first = harness({
    claims: [transient()],
    onConnect: (conn) => {
      conn.open();
    },
  });
  await expect(waitForFeedback(first.deps, FAST)).rejects.toThrow(/down/u);

  const later = harness({
    claims: [EMPTY, transient(), transient(), WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const running = waitForFeedback(later.deps, FAST);
  await new Promise((resolve) => setTimeout(resolve, 20));
  later.connections[0]?.message(FEEDBACK);
  const delivered = await running;
  expect(delivered.outcome).toBe("feedback");
  expect(
    later.log.filter((line) => line === "claim").length,
  ).toBeGreaterThanOrEqual(4);
});

test("a permanent claim failure ends the wait", async () => {
  const h = harness({
    claims: [EMPTY, new ArtifactsCliError("forbidden", "login refused")],
    onConnect: (conn) => {
      conn.open();
    },
  });
  const running = waitForFeedback(h.deps, FAST);
  const failure = expect(running).rejects.toThrow(/login refused/u);
  await new Promise((resolve) => setTimeout(resolve, 20));
  h.connections[0]?.message(FEEDBACK);
  await failure;
});

test("a failed acknowledgement still returns the items and reports the error", async () => {
  let attempts = 0;
  const h = harness({
    claims: [WITH_ITEM],
    onConnect: (conn) => {
      conn.open();
    },
    ack: () => {
      attempts += 1;
      return Promise.reject(new Error("ack down"));
    },
  });
  const result = await waitForFeedback(h.deps, FAST);
  expect(attempts).toBe(3);
  expect(result).toMatchObject({ outcome: "feedback" });
  expect(result.outcome === "feedback" ? result.items : []).toHaveLength(1);
  expect(result.outcome === "feedback" ? result.ackError : null).toBeInstanceOf(
    Error,
  );
});

test("a stream that never answers does not hold the first claim back", async () => {
  const h = harness({ claims: [WITH_ITEM] });
  const started = Date.now();
  const result = await waitForFeedback(h.deps, { ...FAST, connectGraceMs: 50 });
  expect(result.outcome).toBe("feedback");
  expect(Date.now() - started).toBeGreaterThanOrEqual(45);
});

test("the heartbeat reports elapsed time and the connection state", async () => {
  const beats: { connected: boolean }[] = [];
  const h = harness({
    claims: [EMPTY],
    onConnect: (conn) => {
      conn.open();
    },
  });
  await waitForFeedback(
    {
      ...h.deps,
      heartbeat: (info) => {
        beats.push(info);
      },
    },
    { ...FAST, heartbeatMs: 20, timeoutMs: 110 },
  );
  expect(beats.length).toBeGreaterThanOrEqual(3);
  expect(beats.every((beat) => beat.connected)).toBe(true);
});

test("backoff doubles from the base, caps, and jitters between 50 and 100 percent", () => {
  const backoff = { baseMs: 1000, maxMs: 30_000 };
  expect(backoffDelay(0, backoff, () => 1)).toBe(1000);
  expect(backoffDelay(1, backoff, () => 1)).toBe(2000);
  expect(backoffDelay(4, backoff, () => 1)).toBe(16_000);
  expect(backoffDelay(5, backoff, () => 1)).toBe(30_000);
  expect(backoffDelay(20, backoff, () => 1)).toBe(30_000);
  expect(backoffDelay(3, backoff, () => 0)).toBe(4000);
  expect(backoffDelay(3, backoff, () => 0.5)).toBe(6000);
});

export type { Harness };
