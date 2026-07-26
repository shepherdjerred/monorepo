import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { RunStreamInput } from "@shepherdjerred/streambot/machine/types.ts";
import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const U1 = UserIdSchema.parse("100000000000000001");
const INPUT = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
  idleTimeoutMs: 30,
} as const;
const MOVED_CHANNEL = ChannelIdSchema.parse("100000000000000021");
const WAIT = { timeout: 2000 } as const;

function fileSource(title: string): Source {
  return { kind: "file", path: `/videos/${title}.mkv`, title };
}

function makeStreamController() {
  const resolvers: { resolve: () => void; reject: (error: unknown) => void }[] =
    [];
  const inputs: RunStreamInput[] = [];
  const runStream: PlaybackActors["runStream"] = (input) =>
    new Promise<void>((resolve, reject) => {
      inputs.push(input);
      resolvers.push({ resolve, reject });
    });
  return {
    runStream,
    endCurrent: () => {
      resolvers.at(-1)?.resolve();
    },
    crashCurrent: (error: unknown) => {
      resolvers.at(-1)?.reject(error);
    },
    inputs,
    invocationCount: () => resolvers.length,
  };
}

function crashError(
  positionSeconds: number,
  kind: "crash" | "ended-short" = "crash",
): StreamCrashError {
  return new StreamCrashError("ffmpeg exited with code 218", {
    kind,
    positionSeconds,
    pipelineMode: "hw",
    exitCode: kind === "ended-short" ? 0 : 218,
    stderrTail: [],
  });
}

function makeActors(overrides: Partial<PlaybackActors> = {}): PlaybackActors {
  return {
    joinVoice: (input) =>
      Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
    resolveSource: (input) => {
      const { source } = input;
      const title =
        source.kind === "file"
          ? source.title
          : source.kind === "url"
            ? source.url
            : source.query;
      return Promise.resolve({
        title,
        ffmpegInput: `resolved:${title}`,
        chapters: [],
      });
    },
    runStream: () => Promise.resolve(),
    leaveVoice: () => Promise.resolve(),
    ...overrides,
  };
}

function startActor(actors: PlaybackActors) {
  const actor = createActor(createPlaybackMachine(actors), { input: INPUT });
  actor.start();
  return actor;
}

describe("playback machine", () => {
  test("plays a file then winds down to idle after the grace period", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });

    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("movie"),
    );

    stream.endCurrent();
    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
    expect(actor.getSnapshot().context.voice).toBeNull();
  });

  test("advances to the next queued item when a stream ends", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("first"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("second"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("first"),
    );

    stream.endCurrent();
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "second",
      WAIT,
    );
  });

  test("SKIP plays the next item, SKIP on the last winds down", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({ type: "SKIP" });
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "b",
      WAIT,
    );

    actor.send({ type: "SKIP" });
    await waitFor(actor, (s) => s.matches("idle"), WAIT);
  });

  test("STOP clears the queue and leaves", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
  });

  test("streamer detach leaves voice and clears the queue", async () => {
    const stream = makeStreamController();
    let leaveCalls = 0;
    const actor = startActor(
      makeActors({
        runStream: stream.runStream,
        leaveVoice: () => {
          leaveCalls += 1;
          return Promise.resolve();
        },
      }),
    );
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({ type: "STREAMER_VOICE_DETACHED", reason: "kicked" });

    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
    expect(actor.getSnapshot().context.voice).toBeNull();
    expect(actor.getSnapshot().context.lastError).toBe("kicked");
    expect(leaveCalls).toBe(1);
  });

  test("admin voice move updates the active voice target without dropping playback", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({
      type: "VOICE_TARGET_MOVED",
      target: { guildId: INPUT.guildId, channelId: MOVED_CHANNEL },
    });

    expect(actor.getSnapshot().matches("streaming")).toBe(true);
    expect(actor.getSnapshot().context.channelId).toBe(MOVED_CHANNEL);
    expect(actor.getSnapshot().context.voice?.channelId).toBe(MOVED_CHANNEL);
  });

  test("loop=track replays the current item", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("repeat"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    actor.send({ type: "SET_LOOP", mode: "track" });

    stream.endCurrent();
    await waitFor(
      actor,
      (s) => s.matches("streaming") && stream.invocationCount() === 2,
      WAIT,
    );
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("repeat"),
    );
  });

  test("loop=queue cycles items to the back", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    actor.send({ type: "SET_LOOP", mode: "queue" });

    stream.endCurrent();
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "b",
      WAIT,
    );
    // 'a' was cycled to the back of the queue.
    expect(
      actor
        .getSnapshot()
        .context.queue.map((q) =>
          q.source.kind === "file" ? q.source.title : "",
        ),
    ).toEqual(["a"]);
  });

  test("a join failure clears the queue and rests in idle", async () => {
    const actor = startActor(
      makeActors({ joinVoice: () => Promise.reject(new Error("cannot join")) }),
    );
    actor.send({ type: "ADD", source: fileSource("x"), requesterId: U1 });
    await waitFor(
      actor,
      (s) => s.matches("idle") && s.context.lastError !== null,
      WAIT,
    );
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
  });

  test("a blocked source increments the nonce and records the requester", async () => {
    const stream = makeStreamController();
    const actor = startActor(
      makeActors({
        runStream: stream.runStream,
        resolveSource: (input) =>
          input.source.kind === "search"
            ? Promise.reject(new BlockedSourceError(input.source.query))
            : Promise.resolve({ title: "ok", ffmpegInput: "ok", chapters: [] }),
      }),
    );
    actor.send({
      type: "ADD",
      source: { kind: "search", query: "porn" },
      requesterId: U1,
    });

    await waitFor(actor, (s) => s.context.blockedNonce === 1, WAIT);
    expect(actor.getSnapshot().context.lastErrorKind).toBe("blocked");
    expect(actor.getSnapshot().context.lastBlockedRequester).toBe(U1);
  });
});

describe("queue editing events", () => {
  test("ADD_NEXT, REMOVE, MOVE, SHUFFLE, SET_VOLUME", async () => {
    // Hold the first stream open so the queue stays populated while we edit it.
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("c"), requesterId: U1 });
    actor.send({
      type: "ADD_NEXT",
      source: fileSource("front"),
      requesterId: U1,
    });

    const titles = () =>
      actor
        .getSnapshot()
        .context.queue.map((q) =>
          q.source.kind === "file" ? q.source.title : "",
        );
    expect(titles()).toEqual(["front", "b", "c"]);

    actor.send({ type: "REMOVE", index: 2 }); // remove "b"
    expect(titles()).toEqual(["front", "c"]);

    actor.send({ type: "MOVE", from: 1, to: 2 }); // front → after c
    expect(titles()).toEqual(["c", "front"]);

    actor.send({ type: "SHUFFLE" });
    expect(titles().toSorted()).toEqual(["c", "front"]);

    actor.send({ type: "SET_VOLUME", volume: 250 });
    expect(actor.getSnapshot().context.volume).toBe(200);
    actor.send({ type: "SET_VOLUME", volume: -5 });
    expect(actor.getSnapshot().context.volume).toBe(0);
  });
});

function makeSeekRecorder() {
  const seeks: number[] = [];
  const resolvers: (() => void)[] = [];
  const runStream: PlaybackActors["runStream"] = (input) => {
    seeks.push(input.seekSeconds);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };
  return {
    runStream,
    seeks,
    endCurrent: () => {
      resolvers.shift()?.();
    },
  };
}

describe("playback machine — resume", () => {
  test("first item after a resume streams at the saved seek offset", async () => {
    const rec = makeSeekRecorder();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: rec.runStream })),
      {
        input: {
          ...INPUT,
          initialQueue: [{ source: fileSource("movie"), requesterId: U1 }],
          initialSeekSeconds: 90,
        },
      },
    );
    actor.start();

    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(rec.seeks[0]).toBe(90);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("movie"),
    );
  });

  test("consumeSeek: a track-loop replay restarts the same item at 0", async () => {
    const rec = makeSeekRecorder();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: rec.runStream })),
      {
        input: {
          ...INPUT,
          initialQueue: [{ source: fileSource("movie"), requesterId: U1 }],
          initialLoop: "track",
          initialSeekSeconds: 90,
        },
      },
    );
    actor.start();

    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(rec.seeks[0]).toBe(90);

    rec.endCurrent(); // natural end → track loop replays the same item
    await waitFor(actor, () => rec.seeks.length === 2, WAIT);
    expect(rec.seeks[1]).toBe(0);
    expect(actor.getSnapshot().context.resumeSeekSeconds).toBe(0);
  });

  test("the next item after a resumed item streams at 0 (seek not reused)", async () => {
    const rec = makeSeekRecorder();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: rec.runStream })),
      {
        input: {
          ...INPUT,
          initialQueue: [
            { source: fileSource("movie"), requesterId: U1 },
            { source: fileSource("next"), requesterId: U1 },
          ],
          initialSeekSeconds: 90,
        },
      },
    );
    actor.start();

    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(rec.seeks[0]).toBe(90);

    actor.send({ type: "SKIP" });
    await waitFor(actor, () => rec.seeks.length === 2, WAIT);
    expect(rec.seeks[1]).toBe(0);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("next"),
    );
  });
});

describe("CHANGE_SUBTITLES", () => {
  test("restarts the current source with a new subtitle pref at the saved position", async () => {
    const rec = makeSeekRecorder();
    const actor = startActor(makeActors({ runStream: rec.runStream }));
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(rec.seeks[0]).toBe(0);

    actor.send({
      type: "CHANGE_SUBTITLES",
      subtitles: { enabled: true, language: "en" },
      positionSeconds: 42,
    });
    await waitFor(actor, () => rec.seeks.length === 2, WAIT);
    expect(rec.seeks[1]).toBe(42);
    expect(actor.getSnapshot().context.current?.source).toEqual({
      ...fileSource("movie"),
      subtitles: { enabled: true, language: "en" },
    });
  });

  test("a subsequent natural loop after a subtitle restart starts at 0", async () => {
    // The original (pre-restart) `runStream` invoke is abandoned, not resolved, when
    // CHANGE_SUBTITLES tears it down — so unlike `makeSeekRecorder`'s FIFO `endCurrent`, this
    // recorder must resolve the most recently started invoke, not the oldest pending one.
    const seeks: number[] = [];
    const resolvers: (() => void)[] = [];
    const runStream: PlaybackActors["runStream"] = (input) => {
      seeks.push(input.seekSeconds);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream })),
      {
        input: { ...INPUT, initialLoop: "track" },
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({
      type: "CHANGE_SUBTITLES",
      subtitles: { enabled: false },
      positionSeconds: 10,
    });
    await waitFor(actor, () => seeks.length === 2, WAIT);
    expect(seeks[1]).toBe(10);

    resolvers.at(-1)?.(); // natural end of the restarted stream → track loop replays the item
    await waitFor(actor, () => seeks.length === 3, WAIT);
    expect(seeks[2]).toBe(0);
    expect(actor.getSnapshot().context.resumeSeekSeconds).toBe(0);
  });

  test("is ignored while nothing is streaming (no active session)", () => {
    const actor = startActor(makeActors());
    expect(() =>
      actor.send({
        type: "CHANGE_SUBTITLES",
        subtitles: { enabled: true },
        positionSeconds: 0,
      }),
    ).not.toThrow();
    expect(actor.getSnapshot().value).toBe("idle");
  });
});

function urlSource(query: string): Source {
  return { kind: "url", url: `https://example.com/${query}` };
}

describe("preResolved (synchronous pre-validation short-circuit)", () => {
  test("resolveSource actor receives preResolved and its output is used as-is", async () => {
    const seenPreResolved: unknown[] = [];
    const resolveSource: PlaybackActors["resolveSource"] = (input) => {
      seenPreResolved.push(input.preResolved);
      return Promise.resolve(
        input.preResolved ?? {
          title: "fallback",
          ffmpegInput: "should-not-be-used",
          chapters: [],
        },
      );
    };
    const actor = startActor(makeActors({ resolveSource }));
    const stub = { title: "pre", ffmpegInput: "pre://input", chapters: [] };
    actor.send({
      type: "ADD",
      source: urlSource("video"),
      requesterId: U1,
      preResolved: stub,
    });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(seenPreResolved[0]).toEqual(stub);
    expect(actor.getSnapshot().context.resolved).toEqual(stub);
  });

  test("preResolved is consumed once — a track-loop replay re-resolves for real", async () => {
    const seenPreResolved: unknown[] = [];
    const resolveSource: PlaybackActors["resolveSource"] = (input) => {
      seenPreResolved.push(input.preResolved);
      return Promise.resolve(
        input.preResolved ?? {
          title: "re-resolved",
          ffmpegInput: "re-resolved://input",
          chapters: [],
        },
      );
    };
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(
        makeActors({ resolveSource, runStream: stream.runStream }),
      ),
      { input: { ...INPUT, initialLoop: "track" } },
    );
    actor.start();
    const stub = { title: "pre", ffmpegInput: "pre://input", chapters: [] };
    actor.send({
      type: "ADD",
      source: urlSource("video"),
      requesterId: U1,
      preResolved: stub,
    });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    expect(seenPreResolved[0]).toEqual(stub);
    expect(actor.getSnapshot().context.resolved).toEqual(stub);

    stream.endCurrent(); // natural end → track loop replays the same queued item
    await waitFor(actor, () => seenPreResolved.length === 2, WAIT);
    // The second resolve is a real one (preResolved was cleared after its first use).
    expect(seenPreResolved[1]).toBeUndefined();
    await waitFor(
      actor,
      (s) => s.context.resolved?.title === "re-resolved",
      WAIT,
    );
  });
});

describe("crash recovery ladder", () => {
  test("a mid-stream crash re-queues the same item and retries at the crash position", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    stream.crashCurrent(crashError(42));
    await waitFor(
      actor,
      (s) => s.matches("streaming") && stream.invocationCount() === 2,
      WAIT,
    );

    // Same item, resumed at the crash position, still on full hardware for the first retry.
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("movie"),
    );
    expect(stream.inputs[1]?.seekSeconds).toBe(42);
    expect(stream.inputs[1]?.pipelineMode).toBe("hw");
    const notice = actor.getSnapshot().context.crashNotice;
    expect(notice?.kind).toBe("retry");
    expect(notice?.reason).toBe("crash");
    expect(notice?.attempt).toBe(1);
    expect(notice?.positionSeconds).toBe(42);
  });

  test("the ladder walks hw → hw → hw-upload → sw, then gives up and plays the next item", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    // lastErrorKind is transient (cleared when the next item resolves) — observe it via snapshots.
    const errorKinds: (string | null)[] = [];
    actor.subscribe((s) => errorKinds.push(s.context.lastErrorKind));
    actor.send({ type: "ADD", source: fileSource("cursed"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("next"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    for (let attempt = 1; attempt <= 3; attempt++) {
      stream.crashCurrent(crashError(10 * attempt));
      await waitFor(
        actor,
        (s) =>
          s.matches("streaming") && stream.invocationCount() === attempt + 1,
        WAIT,
      );
    }
    expect(stream.inputs.map((i) => i.pipelineMode)).toEqual([
      "hw",
      "hw",
      "hw-upload",
      "sw",
    ]);
    // Each retry resumes where the previous attempt died.
    expect(stream.inputs.map((i) => i.seekSeconds)).toEqual([0, 10, 20, 30]);

    // Fourth crash: budget spent — give up, announce, and continue with the next queued item.
    stream.crashCurrent(crashError(40));
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "next",
      WAIT,
    );
    const context = actor.getSnapshot().context;
    expect(errorKinds).toContain("crash");
    expect(context.crashNotice?.kind).toBe("gave-up");
    expect(context.crashRetries).toBe(0);
    expect(stream.inputs[4]?.pipelineMode).toBe("hw"); // fresh item starts clean
    expect(stream.inputs[4]?.seekSeconds).toBe(0);
  });

  test("an ended-short (exit-0 truncation) crash carries its reason into the notice and does not loop forever under loop:track", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "SET_LOOP", mode: "track" });
    actor.send({ type: "ADD", source: fileSource("trunc"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    for (let attempt = 1; attempt <= 3; attempt++) {
      stream.crashCurrent(crashError(40, "ended-short"));
      await waitFor(
        actor,
        (s) =>
          s.matches("streaming") && stream.invocationCount() === attempt + 1,
        WAIT,
      );
      expect(actor.getSnapshot().context.crashNotice?.reason).toBe(
        "ended-short",
      );
    }
    // Budget spent: the item is dropped even under loop:"track" — no infinite truncated loop.
    stream.crashCurrent(crashError(40, "ended-short"));
    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    expect(stream.invocationCount()).toBe(4);
  });

  test("a natural end resets the retry budget for the next item", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    stream.crashCurrent(crashError(5));
    await waitFor(
      actor,
      (s) => s.matches("streaming") && stream.invocationCount() === 2,
      WAIT,
    );
    stream.endCurrent(); // retry of "a" plays to the end
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "b",
      WAIT,
    );
    expect(actor.getSnapshot().context.crashRetries).toBe(0);
    expect(stream.inputs[2]?.pipelineMode).toBe("hw");
    expect(stream.inputs[2]?.seekSeconds).toBe(0);
  });

  test("SKIP during a crashing item resets the budget for the next item", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    stream.crashCurrent(crashError(5));
    await waitFor(
      actor,
      (s) => s.matches("streaming") && stream.invocationCount() === 2,
      WAIT,
    );
    actor.send({ type: "SKIP" });
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "b",
      WAIT,
    );
    expect(actor.getSnapshot().context.crashRetries).toBe(0);
    expect(stream.inputs[2]?.pipelineMode).toBe("hw");
  });

  test("PRODUCER_STALLED retries at the reported position via the same ladder", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    actor.send({ type: "ADD", source: fileSource("stally"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    actor.send({
      type: "PRODUCER_STALLED",
      reason: "ffmpeg produced no output for 20s",
      positionSeconds: 77,
    });
    await waitFor(
      actor,
      (s) => s.matches("streaming") && stream.invocationCount() === 2,
      WAIT,
    );
    expect(stream.inputs[1]?.seekSeconds).toBe(77);
    const notice = actor.getSnapshot().context.crashNotice;
    expect(notice?.reason).toBe("stall");
    expect(notice?.kind).toBe("retry");
  });

  test("a non-crash stream error still drops the item without retrying", async () => {
    const stream = makeStreamController();
    const actor = startActor(makeActors({ runStream: stream.runStream }));
    const errorKinds: (string | null)[] = [];
    actor.subscribe((s) => errorKinds.push(s.context.lastErrorKind));
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);

    stream.crashCurrent(new Error("plain stream error"));
    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "b",
      WAIT,
    );
    expect(stream.invocationCount()).toBe(2); // no retry of "a"
    expect(errorKinds).toContain("generic");
    expect(actor.getSnapshot().context.crashNotice).toBeNull(); // not a crash — nothing to announce
  });
});

describe("wedge timeouts", () => {
  test("a hung resolve times out, drops the item, and continues", async () => {
    const stream = makeStreamController();
    const errorKinds: (string | null)[] = [];
    const actor = createActor(
      createPlaybackMachine(
        makeActors({
          runStream: stream.runStream,
          resolveSource: (input, signal) =>
            input.source.kind === "file" && input.source.title === "hang"
              ? new Promise((_resolve, reject) => {
                  signal.addEventListener("abort", () => {
                    reject(new Error("aborted"));
                  });
                })
              : makeActors().resolveSource(input, signal),
        }),
      ),
      {
        input: {
          ...INPUT,
          wedgeTimeoutsMs: { resolve: 40 },
        },
      },
    );
    actor.start();
    actor.subscribe((s) => errorKinds.push(s.context.lastErrorKind));
    actor.send({ type: "ADD", source: fileSource("hang"), requesterId: U1 });
    actor.send({ type: "ADD", source: fileSource("ok"), requesterId: U1 });

    await waitFor(
      actor,
      (s) =>
        s.matches("streaming") &&
        s.context.current?.source.kind === "file" &&
        s.context.current.source.title === "ok",
      WAIT,
    );
    expect(errorKinds).toContain("timeout");
  });

  test("a hung voice join times out to idle instead of wedging forever", async () => {
    const actor = createActor(
      createPlaybackMachine(
        makeActors({
          joinVoice: () =>
            new Promise(() => {
              /* never settles — the wedge timeout must fire */
            }),
        }),
      ),
      {
        input: {
          ...INPUT,
          wedgeTimeoutsMs: { join: 40 },
        },
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });

    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    const context = actor.getSnapshot().context;
    expect(context.lastError).toBe("voice join timed out");
    expect(context.lastErrorKind).toBe("timeout");
    expect(context.queue).toHaveLength(0);
  });

  test("a hung leave times out to idle", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(
        makeActors({
          runStream: stream.runStream,
          leaveVoice: () =>
            new Promise(() => {
              /* never settles — the wedge timeout must fire */
            }),
        }),
      ),
      {
        input: {
          ...INPUT,
          wedgeTimeoutsMs: { leave: 40 },
        },
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: U1 });
    await waitFor(actor, (s) => s.matches("streaming"), WAIT);
    actor.send({ type: "STOP" });

    await waitFor(actor, (s) => s.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.lastErrorKind).toBe("timeout");
  });
});
