import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createActor, waitFor } from "xstate";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import {
  buildResumeInput,
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import {
  loadState,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const U = UserIdSchema.parse("100000000000000001");
const BASE = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
  idleTimeoutMs: 30,
} as const;
const WAIT = { timeout: 2000 } as const;

function fileSource(title: string): Source {
  return { kind: "file", path: `/videos/${title}.mkv`, title };
}

/** Actors that resolve sources and record the seek each runStream is invoked with. */
function makeRecordingActors() {
  const seeks: number[] = [];
  const resolvers: (() => void)[] = [];
  const actors: PlaybackActors = {
    joinVoice: (input) =>
      Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
    resolveSource: (input) =>
      Promise.resolve({
        title: input.source.kind === "file" ? input.source.title : "x",
        ffmpegInput: `resolved:${resumeKeyFor(input.source)}`,
      }),
    runStream: (input) => {
      seeks.push(input.seekSeconds);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    leaveVoice: () => Promise.resolve(),
  };
  return { actors, seeks, endCurrent: () => resolvers.shift()?.() };
}

describe("full resume loop (machine + persistence)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true })),
    );
  });

  test("checkpoint → restart → resumes the same item at the saved position", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-loop-"));
    dirs.push(dir);
    const file = stateFilePath(dir);

    // --- Run 1: play a movie with another item queued, then checkpoint mid-stream. ---
    const first = makeRecordingActors();
    const a1 = createActor(createPlaybackMachine(first.actors), {
      input: BASE,
    });
    a1.start();
    a1.send({ type: "SET_LOOP", mode: "queue" });
    a1.send({ type: "SET_VOLUME", volume: 70 });
    a1.send({ type: "ADD", source: fileSource("movie"), requesterId: U });
    a1.send({ type: "ADD", source: fileSource("next"), requesterId: U });

    await waitFor(a1, (s) => s.matches("streaming"), WAIT);
    expect(first.seeks[0]).toBe(0); // fresh play, no resume

    const ctx = a1.getSnapshot().context;
    const POSITION = 45; // pretend the streamer reported this elapsed position
    const snapshot = buildSnapshot({
      context: ctx,
      positionSeconds: POSITION,
      savedAt: 10_000,
      resumeKey: ctx.current ? resumeKeyFor(ctx.current.source) : null,
      resumeAttempts: 0,
    });
    await saveState(file, snapshot);
    a1.stop(); // simulate SIGTERM

    // --- Run 2: boot from disk and confirm it resumes the movie at 45s. ---
    const restored = await loadState(file, 3600, 10_000);
    expect(restored).not.toBeNull();
    const decision = buildResumeInput(restored, BASE, { maxResumeAttempts: 3 });

    const second = makeRecordingActors();
    const a2 = createActor(createPlaybackMachine(second.actors), {
      input: decision.input,
    });
    a2.start();

    await waitFor(a2, (s) => s.matches("streaming"), WAIT);
    expect(second.seeks[0]).toBe(45); // resumed at the saved position
    const ctx2 = a2.getSnapshot().context;
    expect(ctx2.current?.source).toEqual(fileSource("movie"));
    expect(ctx2.queue.map((q) => q.source)).toEqual([fileSource("next")]);
    expect(ctx2.loop).toBe("queue");
    expect(ctx2.volume).toBe(70);
    a2.stop();
  });
});
