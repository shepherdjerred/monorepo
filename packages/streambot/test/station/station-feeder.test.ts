import { ChannelType } from "discord.js";
import { expect, test, vi } from "vitest";
import { WebDiscordContext } from "@shepherdjerred/streambot/discord/web-context.ts";
import {
  sourceIdentity,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { PersistedStation } from "@shepherdjerred/streambot/state/station-schema.ts";
import type {
  CuratedStationItem,
  StationCurator,
} from "@shepherdjerred/streambot/station/station-types.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  guildId,
  harness,
  number,
  statusChannelId,
  userId,
  voiceChannelId,
} from "#numbered-fixture";

function resolveTrackTitle({ source }: { readonly source: Source }) {
  const mediaKind: "music" | "video" =
    source.mode === "music" ? "music" : "video";
  return Promise.resolve({
    title: source.kind === "url" ? (source.title ?? "Clip") : "Clip",
    ffmpegInput: "/clip",
    mediaKind,
    chapters: [],
  });
}

function makeSequentialCurator(): StationCurator {
  let seq = 0;
  return {
    curate: ({ count, excludeIdentities }) => {
      const results: CuratedStationItem[] = [];
      while (results.length < count && seq < 100) {
        seq += 1;
        const vid = `radTrack${String(seq).padStart(3, "0")}`;
        const source: Source = {
          kind: "url",
          url: `https://www.youtube.com/watch?v=${vid}`,
          title: `Radio Track ${String(seq)}`,
          mode: "music",
        };
        if (excludeIdentities.has(sourceIdentity(source))) continue;
        results.push({
          title: `Radio Track ${String(seq)}`,
          source,
          durationSeconds: 180,
        });
      }
      return Promise.resolve(results);
    },
  };
}

function radioStation(seed?: string): PersistedStation {
  return {
    kind: "radio",
    scope: "room",
    ownerId: userId,
    ...(seed === undefined ? {} : { seed }),
    recentIdentities: [],
    skippedIdentities: [],
  };
}

async function startStreamingRadioRoom(seed?: string) {
  const room = await harness(3, {
    resolveSource: resolveTrackTitle,
    stationCurators: { radio: makeSequentialCurator() },
  });
  const started = await room.manager.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
    station: radioStation(seed),
  });
  expect(started).not.toBeNull();
  const handle = room.manager.getExisting(guildId, voiceChannelId, number(1));
  if (handle === null) throw new Error("Expected active slot 1 handle");
  await vi.waitFor(() => {
    expect(handle.view().state).toBe("streaming");
    expect(handle.view().queue).toHaveLength(2);
  });
  return { room, handle };
}

test("StationFeeder maintains a 2-item lookahead and pauses refilling while a human-queued track is active", async () => {
  const { room, handle } = await startStreamingRadioRoom();
  expect(handle.view().current?.title).toBe("Radio Track 1");
  expect(handle.view().queue.map((item) => item.title)).toEqual([
    "Radio Track 2",
    "Radio Track 3",
  ]);

  // Finish Track 1 -> Track 2 starts, feeder automatically refills Track 4 so queue stays at 2!
  room.completions.shift()?.();
  await vi.waitFor(() => {
    expect(handle.view().current?.title).toBe("Radio Track 2");
    expect(handle.view().queue.map((item) => item.title)).toEqual([
      "Radio Track 3",
      "Radio Track 4",
    ]);
  });

  // Remove Track 4 so queue has 1 item, then human queues a manual song via ADD_NEXT:
  handle.dispatch({ type: "REMOVE", index: 2 });
  handle.dispatch({
    type: "ADD_NEXT",
    source: {
      kind: "url",
      url: "https://www.youtube.com/watch?v=mAnUaLs0ng1",
      title: "Manual Request",
      mode: "music",
    },
    requesterId: userId,
    display: { title: "Manual Request" },
  });

  // Advance into Manual Request (queue holds [Radio Track 3], length 1 < 2), feeder waits!
  room.completions.shift()?.();
  await vi.waitFor(() => {
    expect(handle.view().current?.title).toBe("Manual Request");
  });
  expect(handle.view().queue.map((item) => item.title)).toEqual([
    "Radio Track 3",
  ]);

  // Once Manual Request finishes, Radio Track 3 starts and feeder refills 2 lookahead tracks!
  room.completions.shift()?.();
  await vi.waitFor(() => {
    expect(handle.view().current?.title).toBe("Radio Track 3");
    expect(handle.view().queue.map((item) => item.title)).toEqual([
      "Radio Track 5",
      "Radio Track 6",
    ]);
  });
});

test("StationFeeder records SKIP in skippedIdentities and cancels station on CLEAR, STOP, or stopStation", async () => {
  const { room, handle } = await startStreamingRadioRoom("indie");

  const firstId = handle.currentSourceId();
  expect(firstId).toBe("url:https://www.youtube.com/watch?v=radTrack001");

  handle.dispatch({ type: "SKIP" });
  await vi.waitFor(() => {
    expect(handle.view().current?.title).toBe("Radio Track 2");
    expect(handle.view().queue).toHaveLength(2);
  });
  expect(handle.station?.()?.skippedIdentities).toEqual([firstId]);

  const stopped = room.manager.stopStation({
    guildId,
    voiceChannelId,
    playbackChannel: number(1),
  });
  expect(stopped?.seed).toBe("indie");
  expect(handle.station?.()).toBeNull();
  expect(handle.view().queue).toHaveLength(0);
  expect(handle.view().current?.title).toBe("Radio Track 2");

  await room.manager.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
    station: radioStation(),
  });
  await vi.waitFor(() => {
    expect(handle.view().queue).toHaveLength(2);
  });
  handle.dispatch({ type: "CLEAR" });
  expect(handle.station?.()).toBeNull();
  expect(handle.view().queue).toHaveLength(0);

  await room.manager.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
    station: radioStation(),
  });
  expect(handle.station?.()).not.toBeNull();
  handle.dispatch({ type: "STOP" });
  expect(handle.station?.()).toBeNull();
});

test("StationFeeder pauses refilling when voice room has zero humans and WebDiscordContext filters bots/userbots", async () => {
  const humanIds: UserId[] = [userId];
  const room = await harness(3, {
    resolveSource: resolveTrackTitle,
    stationCurators: { radio: makeSequentialCurator() },
    voiceRoomHumanIds: () => humanIds,
  });

  await room.manager.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
    station: radioStation(),
  });
  const handle = room.manager.getExisting(guildId, voiceChannelId, number(1));
  if (handle === null) throw new Error("Expected active slot 1 handle");

  await vi.waitFor(() => {
    expect(handle.view().queue).toHaveLength(2);
  });

  humanIds.length = 0;
  room.completions.shift()?.();
  await vi.waitFor(() => {
    expect(handle.view().current?.title).toBe("Radio Track 2");
  });
  expect(handle.view().queue).toHaveLength(1);

  humanIds.push(userId);
  room.manager.pokeRoomStations(guildId, voiceChannelId);
  await vi.waitFor(() => {
    expect(handle.view().queue).toHaveLength(2);
  });

  const peerBot = "100000000000000088";
  const realHuman = UserIdSchema.parse("100000000000000077");
  const webContext = new WebDiscordContext(
    {
      isReady: () => true,
      user: { id: "100000000000000055" },
      application: { id: "app" },
      guilds: {
        cache: new Map([
          [
            guildId,
            {
              id: guildId,
              name: "Test Guild",
              members: { fetch: () => Promise.resolve({}) },
              channels: {
                cache: new Map([
                  [
                    voiceChannelId,
                    { type: ChannelType.GuildVoice, name: "Lounge" },
                  ],
                ]),
              },
              voiceStates: {
                cache: new Map([
                  [
                    realHuman,
                    {
                      channelId: voiceChannelId,
                      member: { user: { bot: false } },
                    },
                  ],
                  [
                    peerBot,
                    {
                      channelId: voiceChannelId,
                      member: { user: { bot: false } },
                    },
                  ],
                  [
                    "100000000000000066",
                    {
                      channelId: voiceChannelId,
                      member: { user: { bot: true } },
                    },
                  ],
                ]),
              },
            },
          ],
        ]),
      },
    },
    () => new Set([peerBot]),
  );
  expect(webContext.voiceRoomHumanIds(guildId, voiceChannelId)).toEqual([
    realHuman,
  ]);
});

test("StationFeeder persists station metadata and resumes slot across restart even if queue was empty", async () => {
  const curator = makeSequentialCurator();
  let allowCuration = false;
  const room = await harness(3, {
    resolveSource: resolveTrackTitle,
    stationCurators: {
      radio: {
        curate: (ctx) =>
          allowCuration ? curator.curate(ctx) : Promise.resolve([]),
      },
    },
    featureGate: {
      numberedChannels: () => Promise.resolve(true),
      assistantV2: () => Promise.resolve(false),
      history: () => Promise.resolve(false),
      musicOverVoice: () => Promise.resolve(true),
      radio: () => Promise.resolve(true),
    },
  });

  await room.manager.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
    station: radioStation("late-night jazz"),
  });
  await room.manager.destroyAll();

  allowCuration = true;
  const recovered = room.restart();
  await recovered.resumeAll();

  await vi.waitFor(() => {
    const resumed = recovered.getExisting(guildId, voiceChannelId, number(1));
    expect(resumed?.station?.()?.seed).toBe("late-night jazz");
    expect(resumed?.view().state).toBe("streaming");
    expect(resumed?.view().queue).toHaveLength(2);
  });
});
