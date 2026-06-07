import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

const INPUT = { guildId: "1", channelId: "2" } as const;
const WAIT = { timeout: 2000 } as const;

function fileSource(title: string): Source {
  return { kind: "file", path: `/videos/${title}.mkv`, title };
}

/** Lets a test hold a `runStream` invocation open and end it (or fail it) on demand. */
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
    failCurrent: (error: unknown) => {
      resolvers.at(-1)?.reject(error);
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
      return Promise.resolve({ title, ffmpegInput: `resolved:${title}` });
    },
    runStream: () => Promise.resolve(),
    leaveVoice: () => Promise.resolve(),
    ...overrides,
  };
}

describe("playback machine", () => {
  test("plays a queued file through join → resolve → stream → leave → idle", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: stream.runStream })),
      {
        input: INPUT,
      },
    );
    actor.start();
    expect(actor.getSnapshot().value).toBe("idle");

    actor.send({ type: "ADD", source: fileSource("movie"), requesterId: "u1" });

    await waitFor(actor, (snap) => snap.matches("streaming"), WAIT);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("movie"),
    );
    expect(actor.getSnapshot().context.resolved?.ffmpegInput).toBe(
      "resolved:movie",
    );

    stream.endCurrent();
    await waitFor(actor, (snap) => snap.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
    expect(actor.getSnapshot().context.current).toBeNull();
    expect(actor.getSnapshot().context.voice).toBeNull();
  });

  test("advances to the next queued item when a stream ends", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: stream.runStream })),
      {
        input: INPUT,
      },
    );
    actor.start();

    actor.send({ type: "ADD", source: fileSource("first"), requesterId: "u1" });
    actor.send({
      type: "ADD",
      source: fileSource("second"),
      requesterId: "u1",
    });

    await waitFor(actor, (snap) => snap.matches("streaming"), WAIT);
    expect(actor.getSnapshot().context.current?.source).toEqual(
      fileSource("first"),
    );

    stream.endCurrent();
    await waitFor(
      actor,
      (snap) =>
        snap.matches("streaming") &&
        snap.context.current?.source.kind === "file" &&
        snap.context.current.source.title === "second",
      WAIT,
    );
    expect(stream.invocationCount()).toBe(2);
  });

  test("SKIP cancels the current stream and plays the next", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: stream.runStream })),
      {
        input: INPUT,
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: "u1" });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: "u1" });
    await waitFor(actor, (snap) => snap.matches("streaming"), WAIT);

    actor.send({ type: "SKIP" });
    await waitFor(
      actor,
      (snap) =>
        snap.matches("streaming") &&
        snap.context.current?.source.kind === "file" &&
        snap.context.current.source.title === "b",
      WAIT,
    );
  });

  test("SKIP on the last item winds down to idle", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: stream.runStream })),
      {
        input: INPUT,
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("only"), requesterId: "u1" });
    await waitFor(actor, (snap) => snap.matches("streaming"), WAIT);

    actor.send({ type: "SKIP" });
    await waitFor(actor, (snap) => snap.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
  });

  test("STOP clears the queue and leaves", async () => {
    const stream = makeStreamController();
    const actor = createActor(
      createPlaybackMachine(makeActors({ runStream: stream.runStream })),
      {
        input: INPUT,
      },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("a"), requesterId: "u1" });
    actor.send({ type: "ADD", source: fileSource("b"), requesterId: "u1" });
    await waitFor(actor, (snap) => snap.matches("streaming"), WAIT);

    actor.send({ type: "STOP" });
    await waitFor(actor, (snap) => snap.matches("idle"), WAIT);
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
  });

  test("a join failure clears the queue and rests in idle (no hot-loop)", async () => {
    const actor = createActor(
      createPlaybackMachine(
        makeActors({
          joinVoice: () => Promise.reject(new Error("cannot join")),
        }),
      ),
      { input: INPUT },
    );
    actor.start();
    actor.send({ type: "ADD", source: fileSource("x"), requesterId: "u1" });

    await waitFor(
      actor,
      (snap) => snap.matches("idle") && snap.context.lastError !== null,
      WAIT,
    );
    expect(actor.getSnapshot().context.lastError).toBe("cannot join");
    expect(actor.getSnapshot().context.queue).toHaveLength(0);
  });

  test("a resolve failure drops the bad item and continues with the next", async () => {
    let resolveCalls = 0;
    const stream = makeStreamController();
    const actors = makeActors({
      runStream: stream.runStream,
      resolveSource: (input) => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return Promise.reject(new Error("unresolvable"));
        }
        const { source } = input;
        const title =
          source.kind === "file"
            ? source.title
            : source.kind === "url"
              ? source.url
              : source.query;
        return Promise.resolve({ title, ffmpegInput: `resolved:${title}` });
      },
    });
    const actor = createActor(createPlaybackMachine(actors), { input: INPUT });
    actor.start();
    actor.send({ type: "ADD", source: fileSource("bad"), requesterId: "u1" });
    actor.send({ type: "ADD", source: fileSource("good"), requesterId: "u1" });

    await waitFor(
      actor,
      (snap) =>
        snap.matches("streaming") &&
        snap.context.current?.source.kind === "file" &&
        snap.context.current.source.title === "good",
      WAIT,
    );
    expect(resolveCalls).toBe(2);
  });
});
