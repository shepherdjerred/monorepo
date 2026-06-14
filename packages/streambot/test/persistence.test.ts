import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadState,
  moveState,
  saveState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const G = GuildIdSchema.parse("100000000000000010");
const C = ChannelIdSchema.parse("100000000000000020");
const C2 = ChannelIdSchema.parse("100000000000000021");
const U = UserIdSchema.parse("100000000000000001");

function makeState(over: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 2,
    savedAt: 1000,
    guildId: G,
    channelId: C,
    statusChannelId: C,
    loop: "off",
    volume: 100,
    current: {
      source: { kind: "file", path: "/videos/movie.mkv", title: "Movie" },
      requesterId: U,
      title: "Movie",
      positionSeconds: 42,
    },
    queue: [],
    resumeAttempts: 0,
    resumeKey: "file:/videos/movie.mkv",
    ...over,
  };
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "streambot-state-"));
  dirs.push(dir);
  return dir;
}
async function tempFile(): Promise<string> {
  return stateFilePath(await tempDir(), G, C);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("persistence round-trip", () => {
  test("saveState then loadState returns equivalent data", async () => {
    const file = await tempFile();
    const state = makeState();
    await saveState(file, state);
    const loaded = await loadState(file, 3600, state.savedAt);
    expect(loaded).toEqual(state);
  });

  test("saveState is atomic — leaves no .tmp file behind", async () => {
    const file = await tempFile();
    await saveState(file, makeState());
    const entries = await readdir(path.dirname(file));
    expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("saveState creates the directory if missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-state-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "deep", "playback-state.json");
    await saveState(file, makeState());
    expect(await loadState(file, 3600, 1000)).not.toBeNull();
  });
});

describe("loadState fail-soft cases", () => {
  test("missing file returns null", async () => {
    const file = await tempFile();
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });

  test("corrupt JSON returns null (never throws)", async () => {
    const file = await tempFile();
    await writeFile(file, "{ not json");
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });

  test("rejects unknown/extra keys (strictObject)", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ ...makeState(), bogus: true }));
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });

  test("rejects a future schema version", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ ...makeState(), version: 3 }));
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });

  test("rejects a legacy v1 file (cutover)", async () => {
    const file = await tempFile();
    const { statusChannelId: _drop, ...v1 } = makeState();
    await writeFile(file, JSON.stringify({ ...v1, version: 1 }));
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });
});

describe("loadState staleness guard", () => {
  test("loads at exactly maxAge, rejects just past it", async () => {
    const file = await tempFile();
    await saveState(file, makeState({ savedAt: 1000 }));
    // maxAge = 10s → age 10s loads, age 10.001s is rejected.
    expect(await loadState(file, 10, 1000 + 10_000)).not.toBeNull();
    expect(await loadState(file, 10, 1000 + 10_001)).toBeNull();
  });
});

describe("schema validation of fields", () => {
  test("rejects a negative positionSeconds", async () => {
    const file = await tempFile();
    const bad = makeState();
    await writeFile(
      file,
      JSON.stringify({
        ...bad,
        current: { ...bad.current, positionSeconds: -5 },
      }),
    );
    expect(await loadState(file, 3600, 1000)).toBeNull();
  });

  test("accepts a null current (nothing was playing)", async () => {
    const file = await tempFile();
    await saveState(file, makeState({ current: null, resumeKey: null }));
    const loaded = await loadState(file, 3600, 1000);
    expect(loaded?.current).toBeNull();
  });
});

describe("moveState — session rekey to a new channel", () => {
  test("moves the snapshot to the new path and rewrites its channelId", async () => {
    const dir = await tempDir();
    const from = stateFilePath(dir, G, C);
    const to = stateFilePath(dir, G, C2);
    await saveState(from, makeState());

    await moveState({ fromPath: from, toPath: to, guildId: G, channelId: C2 });

    // The new path holds the snapshot, the old path is gone, and the file's channelId now matches the
    // new channel so buildResumeInput's channel check passes on resume (the bug being fixed: otherwise
    // the renamed file would carry the old channelId and resume would discard everything).
    const moved = await loadState(to, 3600, makeState().savedAt);
    expect(moved).not.toBeNull();
    expect(moved?.channelId).toBe(C2);
    expect(moved?.current?.positionSeconds).toBe(42);
    expect(await loadState(from, 3600, makeState().savedAt)).toBeNull();
  });

  test("at no point is the snapshot absent from both paths (no crash window)", async () => {
    const dir = await tempDir();
    const from = stateFilePath(dir, G, C);
    const to = stateFilePath(dir, G, C2);
    await saveState(from, makeState());

    await moveState({ fromPath: from, toPath: to, guildId: G, channelId: C2 });

    // Exactly one state file exists afterwards — the deleted source never preceded the new write.
    const entries = await readdir(dir);
    const stateFiles = entries.filter((name) =>
      name.startsWith("playback-state-"),
    );
    expect(stateFiles.length).toBe(1);
    expect(stateFiles[0]).toBe(path.basename(to));
  });

  test("a missing source file is a no-op (nothing persisted yet)", async () => {
    const dir = await tempDir();
    const from = stateFilePath(dir, G, C);
    const to = stateFilePath(dir, G, C2);

    await moveState({ fromPath: from, toPath: to, guildId: G, channelId: C2 });

    expect(await loadState(to, 3600, 1000)).toBeNull();
  });

  test("identical from/to paths is a no-op that leaves the file intact", async () => {
    const dir = await tempDir();
    const from = stateFilePath(dir, G, C);
    await saveState(from, makeState());

    await moveState({ fromPath: from, toPath: from, guildId: G, channelId: C });

    expect(await loadState(from, 3600, makeState().savedAt)).not.toBeNull();
  });
});
