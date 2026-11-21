import { describe, expect, test } from "vitest";
import type {
  WebRoom,
  WebRoomPlayer,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  playCommand,
  playConfirmation,
  playerCommand,
  roomTarget,
  stationCommand,
} from "@shepherdjerred/streambot/web/client/commands.ts";

const CAPABILITIES: WebRoom["capabilities"] = {
  listen: true,
  sports: true,
  history: true,
  radio: true,
  tv: true,
  pause: true,
  playNow: true,
  lolEsports: false,
  musicCatalog: true,
  playlists: true,
  spotifyLinks: true,
  plexPosters: false,
};

function player(slot: number, transport: "listen" | "watch"): WebRoomPlayer {
  return {
    slot,
    transport,
    revision: "rev-" + String(slot),
    state: "streaming",
    current: {
      title: "Now",
      durationSeconds: 100,
      mediaKind: transport === "listen" ? "music" : "video",
      token: "token-" + String(slot),
    },
    queue: [],
    positionSeconds: 10,
    positionAt: 1000,
    paused: false,
    volume: 100,
    loop: "off",
    station: null,
    restrictedLive: false,
  };
}

function room(overrides: Partial<WebRoom> = {}): WebRoom {
  return {
    location: {
      guild: { id: "10", name: "Guild" },
      channel: { id: "20", name: "Movie night" },
    },
    guilds: [{ id: "10", name: "Guild" }],
    browseGuildId: "10",
    players: [player(1, "listen"), player(2, "watch")],
    capacity: { maxSlots: 4, extraStreamAvailable: true, numbered: true },
    capabilities: CAPABILITIES,
    serverTime: 1000,
    ...overrides,
  };
}

describe("roomTarget", () => {
  test("is null when the viewer is in no voice channel", () => {
    expect(roomTarget(room({ location: null }))).toBeNull();
  });

  test("names the first free extra slot for another stream", () => {
    const target = roomTarget(
      room({ players: [player(1, "listen"), player(3, "watch")] }),
    );
    expect(target).toMatchObject({
      guildId: "10",
      channelId: "20",
      voiceChannelName: "Movie night",
      legacy: false,
      extraSlot: 4,
    });
  });

  test("offers no extra slot when the server says none is available", () => {
    const target = roomTarget(
      room({
        capacity: { maxSlots: 3, extraStreamAvailable: false, numbered: true },
      }),
    );
    expect(target?.extraSlot).toBeNull();
  });

  test("treats a room the server reports as not numbered as one shared queue", () => {
    const target = roomTarget(
      room({
        capacity: { maxSlots: 1, extraStreamAvailable: false, numbered: false },
      }),
    );
    expect(target?.legacy).toBe(true);
  });
});

describe("row to command", () => {
  const target = roomTarget(room());
  if (target === null) throw new Error("fixture room has a location");

  test("Listen and Watch name their transport and leave the slot to the server", () => {
    const command = playCommand(target, {
      selection: { kind: "music", id: "song" },
      transport: "listen",
      placement: "queue",
    });
    expect(command).toMatchObject({
      action: "play",
      transport: "listen",
      placement: "queue",
      playbackChannel: null,
      guildId: "10",
      channelId: "20",
    });
    for (const ignored of ["selectionVersion", "slotRevisions", "targeting"])
      expect(command).not.toHaveProperty(ignored);
  });

  test("Start another stream targets the free extra slot with Watch", () => {
    const command = playCommand(target, {
      selection: { kind: "candidate", id: "video" },
      transport: "watch",
      placement: "queue",
      anotherStream: true,
    });
    expect(command).toMatchObject({ transport: "watch", playbackChannel: 3 });
  });

  test("transport controls carry the current item's token", () => {
    expect(
      playerCommand(target, player(2, "watch"), { action: "skip" }),
    ).toMatchObject({
      action: "skip",
      playbackChannel: 2,
      expectCurrent: "token-2",
      revision: "rev-2",
    });
    expect(
      playerCommand(target, player(1, "listen"), {
        action: "seek",
        seconds: 30,
      }),
    ).toMatchObject({ seconds: 30, expectCurrent: "token-1" });
  });

  test("queue edits carry the viewed revision and no item token", () => {
    const command = playerCommand(target, player(1, "listen"), {
      action: "move",
      from: 3,
      to: 2,
    });
    expect(command).toMatchObject({ revision: "rev-1", from: 3, to: 2 });
    expect(command).not.toHaveProperty("expectCurrent");
  });

  test("a legacy room never names a slot", () => {
    const legacy = { ...target, legacy: true };
    expect(
      playerCommand(legacy, player(1, "listen"), { action: "stop" }),
    ).toMatchObject({ playbackChannel: null });
  });

  test("the server picks the station slot; Stop names its card", () => {
    expect(
      stationCommand(target, { mode: "radio", scope: "room", seed: "  " }),
    ).toMatchObject({ mode: "radio", playbackChannel: null, scope: "room" });
    expect(
      stationCommand(target, { mode: "radio", scope: "room", seed: "  " }),
    ).not.toHaveProperty("seed");
    expect(
      stationCommand(target, { mode: "tv", scope: "mine", tvPreset: "movies" }),
    ).toMatchObject({ playbackChannel: null, tvPreset: "movies" });
    expect(stationCommand(target, { mode: "off", slot: 3 })).toMatchObject({
      mode: "off",
      playbackChannel: 3,
    });
  });
});

describe("playConfirmation", () => {
  test("names the queue and place it was added to", () => {
    expect(
      playConfirmation(
        {
          message: "Queued.",
          position: 3,
          destination: { transport: "listen", voiceChannelName: "Movie night" },
        },
        "listen",
      ),
    ).toBe("Added to Listen queue · #3");
  });

  test("says where it started when nothing was ahead of it", () => {
    expect(
      playConfirmation(
        {
          message: "Playing.",
          position: 0,
          destination: { transport: "watch", voiceChannelName: "Movie night" },
        },
        "watch",
      ),
    ).toBe("Now streaming in Movie night");
  });

  test("falls back to the server message without a position", () => {
    expect(playConfirmation({ message: "Queued 12 tracks." }, "listen")).toBe(
      "Queued 12 tracks.",
    );
  });
});
