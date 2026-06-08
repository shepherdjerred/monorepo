import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadState,
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
const U = UserIdSchema.parse("100000000000000001");

function makeState(over: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 1,
    savedAt: 1000,
    guildId: G,
    channelId: C,
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
async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "streambot-state-"));
  dirs.push(dir);
  return stateFilePath(dir);
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
    await writeFile(file, JSON.stringify({ ...makeState(), version: 2 }));
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
