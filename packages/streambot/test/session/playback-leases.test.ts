import { describe, expect, test } from "vitest";
import { PlaybackLeases } from "@shepherdjerred/streambot/session/playback-leases.ts";
import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type {
  JoinVoiceInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { voiceDisabledStreamerParts } from "./fake-streamer-voice.ts";

const guildId = GuildIdSchema.parse("100000000000000001");
const channelId = ChannelIdSchema.parse("100000000000000010");
const room = `${guildId}:${channelId}`;
const input: JoinVoiceInput = { guildId, channelId };
const audio = PlaybackChannelNumberSchema.parse(1);
const video = PlaybackChannelNumberSchema.parse(2);

function account(
  joinVoice: StreamerLike["joinVoice"],
  leave: { count: number },
): { pool: UserbotProvider; signal: () => AbortSignal | undefined } {
  let handshake: AbortSignal | undefined;
  const lane = (): StreamerLike => ({
    login: () => Promise.resolve(),
    guildIds: () => [guildId],
    destroy: () => Promise.resolve(),
    joinVoice: (next, signal) => {
      handshake = signal;
      return joinVoice(next, signal);
    },
    runStream: () => Promise.resolve(),
    leaveVoice: () => {
      leave.count += 1;
      return Promise.resolve();
    },
    getPosition: () => null,
    lastVoiceCloseInfo: () => null,
    captureVoiceCloseSource: () => ({
      lastVoiceCloseInfo: () => null,
      release: () => {
        /* retained close state is unused */
      },
    }),
    setVoiceCloseListener: () => {
      /* the lease installs its own listener */
    },
    setStallListener: () => {
      /* stalls are not part of this lease */
    },
    ...voiceDisabledStreamerParts(),
  });
  const physical = lane();
  physical.createPlaybackHandle = () => lane();
  const entry: UserbotEntry = {
    userbot: physical,
    guildIds: new Set([guildId]),
    busy: false,
  };
  return {
    signal: () => handshake,
    pool: {
      acquire: () => {
        if (entry.busy) return null;
        entry.busy = true;
        return entry;
      },
      release: (released) => {
        released.busy = false;
      },
      canServe: () => true,
    },
  };
}

async function releaseOrWedge(leases: PlaybackLeases, entry: UserbotEntry) {
  const verdict = await Promise.race([
    leases.release(entry).then(() => "released" as const),
    new Promise<"wedged">((resolve) => {
      setTimeout(() => {
        resolve("wedged");
      }, 500);
    }),
  ]);
  expect(verdict).toBe("released");
}

describe("playback leases", () => {
  test("a handshake that never finishes gives the account back", async () => {
    const leave = { count: 0 };
    const { pool, signal } = account(
      () =>
        new Promise<VoiceHandle>(() => {
          /* Discord never answers this handshake */
        }),
      leave,
    );
    const leases = new PlaybackLeases(pool);
    const entry = leases.acquire(room, guildId, audio);
    if (entry === null) {
      throw new Error("expected an account");
    }
    const joining = entry.userbot.joinVoice(
      input,
      new AbortController().signal,
    );

    await releaseOrWedge(leases, entry);

    expect(signal()?.aborted).toBe(true);
    expect(leave.count).toBe(1);
    await expect(joining).rejects.toThrow("Voice join aborted");
    expect(leases.acquire(room, guildId, audio)).not.toBeNull();
  });

  test("a refused join still returns the account", async () => {
    const leave = { count: 0 };
    const { pool, signal } = account(
      () => Promise.reject(new Error("Missing Access")),
      leave,
    );
    const leases = new PlaybackLeases(pool);
    const entry = leases.acquire(room, guildId, audio);
    if (entry === null) {
      throw new Error("expected an account");
    }
    const joining = entry.userbot.joinVoice(
      input,
      new AbortController().signal,
    );

    await expect(joining).rejects.toThrow("Missing Access");
    await releaseOrWedge(leases, entry);

    expect(signal()?.aborted).toBe(true);
    expect(leave.count).toBe(1);
    expect(leases.acquire(room, guildId, audio)).not.toBeNull();
  });

  test("one shared slot can leave without cancelling the other slot's handshake", async () => {
    const leave = { count: 0 };
    let finish: ((handle: VoiceHandle) => void) | undefined;
    const { pool, signal } = account(
      () =>
        new Promise<VoiceHandle>((resolve) => {
          finish = resolve;
        }),
      leave,
    );
    const leases = new PlaybackLeases(pool);
    const mic = leases.acquire(room, guildId, audio);
    const picture = leases.acquire(room, guildId, video);
    if (mic === null || picture === null) {
      throw new Error("expected both slots");
    }
    const joining = mic.userbot.joinVoice(input, new AbortController().signal);
    void picture.userbot.joinVoice(input, new AbortController().signal);

    await leases.release(mic);

    expect(signal()?.aborted).toBe(false);
    expect(leave.count).toBe(0);
    expect(leases.acquire(`${room}:other`, guildId, audio)).toBeNull();
    if (finish === undefined) {
      throw new Error("join did not start");
    }
    finish(input);
    await joining;
    await leases.release(picture);
    expect(signal()?.aborted).toBe(true);
    expect(leave.count).toBe(1);
    expect(leases.acquire(room, guildId, audio)).not.toBeNull();
  });
});
