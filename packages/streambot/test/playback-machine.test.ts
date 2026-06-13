import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
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
  const runStream: PlaybackActors["runStream"] = () =>
    new Promise<void>((resolve, reject) => {
      resolvers.push({ resolve, reject });
    });
  return {
    runStream,
    endCurrent: () => {
      resolvers.at(-1)?.resolve();
    },
    invocationCount: () => resolvers.length,
  };
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
