import { afterEach, describe, expect, test } from "vitest";
import {
  ErrorSchema,
  RoomSchema,
  type WebRoom,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ChannelIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import {
  CHANNEL,
  GUILD,
  SECOND_GUILD,
  USER,
  webFixture,
} from "./web-fixture.ts";
import {
  MOVIE_SOURCE,
  multiSlotRoom,
  resolveByMode,
  SONG_SOURCE,
  STATION,
} from "./web-fixture-room.ts";
import { getRequest, playerOf } from "./web-room-harness.ts";

const SECOND_CHANNEL = ChannelIdSchema.parse("100000000000000021");
const SLOT = (number: number) => PlaybackChannelNumberSchema.parse(number);
let fixture: ReturnType<typeof webFixture>;

afterEach(() => {
  fixture.close();
});

function setup() {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", true, {
    radioEnabled: true,
    resolve: resolveByMode,
  });
  return fixture;
}

async function room(path = "/api/room"): Promise<WebRoom> {
  const response = await fixture.handler(getRequest(fixture, path));
  expect(response.status).toBe(200);
  return RoomSchema.parse(await response.json());
}

describe("location", () => {
  test("is read from voice state, with the shared servers alongside", async () => {
    setup();
    const value = await room();
    expect(value.location).toEqual({
      guild: { id: GUILD, name: "The living room" },
      channel: { id: CHANNEL, name: "Movie night" },
    });
    expect(value.browseGuildId).toBe(GUILD);
    expect(value.guilds.map((guild) => guild.id)).toEqual([
      GUILD,
      SECOND_GUILD,
    ]);
    expect(value.players).toEqual([]);
    expect(value.serverTime).toBeGreaterThan(0);
  });

  test("finds the viewer in the second shared server", async () => {
    setup();
    fixture.setChannel(null);
    fixture.setChannelIn(SECOND_GUILD, { id: SECOND_CHANNEL, name: "Studio" });
    const value = await room();
    expect(value.location?.guild.id).toBe(SECOND_GUILD);
    expect(value.location?.channel).toEqual({
      id: SECOND_CHANNEL,
      name: "Studio",
    });
    expect(value.browseGuildId).toBe(SECOND_GUILD);
  });

  test("is null when the viewer is in no voice channel", async () => {
    setup();
    fixture.setChannel(null);
    const value = await room();
    expect(value.location).toBeNull();
    expect(value.players).toEqual([]);
    expect(value.browseGuildId).toBe(GUILD);
    expect(value.capacity).toEqual({
      maxSlots: 1,
      numbered: false,
      extraStreamAvailable: false,
    });
    expect(value.capabilities.pause).toBe(false);
  });

  test("uses the guildId query only to browse while in no voice channel", async () => {
    setup();
    fixture.setChannel(null);
    const browsing = await room("/api/room?guildId=" + SECOND_GUILD);
    expect(browsing.location).toBeNull();
    expect(browsing.browseGuildId).toBe(SECOND_GUILD);
    const refused = await fixture.handler(
      getRequest(fixture, "/api/room?guildId=100000000000000099"),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      code: "guild_denied",
    });
    const malformed = await fixture.handler(
      getRequest(fixture, "/api/room?guildId=nope"),
    );
    expect(malformed.status).toBe(400);
  });

  test("a client-supplied guildId cannot move an in-voice viewer's room", async () => {
    setup();
    const value = await room("/api/room?guildId=" + SECOND_GUILD);
    expect(value.location?.guild.id).toBe(GUILD);
    expect(value.browseGuildId).toBe(GUILD);
  });

  test("ignores a server whose web remote is disabled", async () => {
    setup();
    fixture.setChannel(null);
    fixture.setChannelIn(SECOND_GUILD, { id: SECOND_CHANNEL, name: "Studio" });
    fixture.setGuildEnabled(SECOND_GUILD, false);
    const value = await room();
    expect(value.location).toBeNull();
    expect(value.browseGuildId).toBe(GUILD);
  });

  test("picks the lowest server id when the voice cache places the viewer in two", async () => {
    setup();
    fixture.setChannelIn(SECOND_GUILD, { id: SECOND_CHANNEL, name: "Studio" });
    const both = await room();
    expect(both.location?.guild.id).toBe(GUILD);
    fixture.setGuildEnabled(GUILD, false);
    const onlySecond = await room();
    expect(onlySecond.location?.guild.id).toBe(SECOND_GUILD);
  });

  test("is refused when no server is usable", async () => {
    setup();
    fixture.setEnabled(false);
    const response = await fixture.handler(getRequest(fixture, "/api/room"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "feature_disabled",
    });
  });

  test("requires sign-in", async () => {
    setup();
    const response = await fixture.handler(
      new Request("http://127.0.0.1:8080/api/room"),
    );
    expect(response.status).toBe(401);
  });
});

describe("players", () => {
  test("Listen and Watch are returned together", async () => {
    setup();
    const slots = multiSlotRoom(fixture);
    await slots.play(1, SONG_SOURCE);
    await slots.play(2, MOVIE_SOURCE);
    const value = await room();
    expect(value.players.map((entry) => [entry.slot, entry.transport])).toEqual(
      [
        [1, "listen"],
        [2, "watch"],
      ],
    );
    const listen = playerOf(value, 1);
    expect(listen?.state).toBe("streaming");
    expect(listen?.current?.title).toBe("Room Test Song");
    expect(listen?.current?.token).toEqual(expect.any(String));
    expect(listen?.revision).toEqual(expect.any(String));
    expect(listen?.positionAt).toBeGreaterThan(0);
    expect(listen?.volume).toBe(100);
    expect(value.capacity).toEqual({
      maxSlots: 3,
      numbered: true,
      extraStreamAvailable: true,
    });
  });

  test("a track names its song and artists apart; other items keep one title", async () => {
    setup();
    const slots = multiSlotRoom(fixture);
    await slots.play(1, SONG_SOURCE);
    slots.ensure(SLOT(1)).actor.send({
      type: "ADD",
      source: SONG_SOURCE,
      requesterId: USER,
      queuedAt: Date.now(),
    });
    await slots.play(2, MOVIE_SOURCE);
    const value = await room();
    const listen = playerOf(value, 1);
    for (const item of [listen?.current, listen?.queue[0]])
      expect(item).toMatchObject({
        title: "Room Test Song",
        subtitle: "Room Test Artist",
      });
    const watch = playerOf(value, 2)?.current;
    expect(watch?.title).toBe("Arrival");
    expect(watch).not.toHaveProperty("subtitle");
  });

  test("Radio and TV start on their own slot without naming one; stopping still needs the slot", async () => {
    setup();
    const slots = multiSlotRoom(fixture);
    const station = async (mode: string, playbackChannel: number | null) => {
      const response = await fixture.handler(
        fixture.command({
          action: "station",
          mode,
          playbackChannel,
        }),
      );
      return response.status;
    };
    expect(await station("radio", null)).toBe(200);
    expect(await station("tv", null)).toBe(200);
    expect(slots.slots.get(SLOT(1))?.station?.kind).toBe("radio");
    expect(slots.slots.get(SLOT(2))?.station?.kind).toBe("tv");
    const value = await room();
    expect(playerOf(value, 1)?.station?.kind).toBe("radio");
    expect(playerOf(value, 2)?.station?.kind).toBe("tv");
    const unnamed = await fixture.handler(
      fixture.command({
        action: "station",
        mode: "off",
        playbackChannel: null,
      }),
    );
    expect(unnamed.status).toBe(400);
    expect(await unnamed.json()).toMatchObject({ code: "invalid_channel" });
    const pause = await fixture.handler(
      fixture.command({
        action: "pause",
        playbackChannel: null,
      }),
    );
    expect(pause.status).toBe(400);
    expect(await station("off", 2)).toBe(200);
    expect(slots.slots.get(SLOT(2))?.station).toBeUndefined();
    expect(slots.slots.get(SLOT(1))?.station?.kind).toBe("radio");
  });

  test("a numbered room says so even before anything plays", async () => {
    setup();
    multiSlotRoom(fixture);
    const value = await room();
    expect(value.players).toEqual([]);
    expect(value.capacity.numbered).toBe(true);
  });

  test("a third stream is returned and uses up the extra capacity", async () => {
    setup();
    const slots = multiSlotRoom(fixture);
    await slots.play(1, SONG_SOURCE);
    await slots.play(2, MOVIE_SOURCE);
    await slots.play(3, MOVIE_SOURCE);
    const value = await room();
    expect(value.players.map((entry) => entry.slot)).toEqual([1, 2, 3]);
    expect(playerOf(value, 3)?.transport).toBe("watch");
    expect(value.capacity.extraStreamAvailable).toBe(false);
  });

  test("a station holds its slot with an empty queue", async () => {
    setup();
    const slots = multiSlotRoom(fixture);
    slots.ensure(PlaybackChannelNumberSchema.parse(1)).station = STATION;
    const value = await room();
    expect(playerOf(value, 1)?.station).toEqual({
      kind: "radio",
      scope: "room",
    });
  });

  test("a legacy room is one player whose transport follows the current item", async () => {
    setup();
    await fixture.seed();
    const value = await room();
    expect(value.players).toHaveLength(1);
    expect(value.players[0]).toMatchObject({ slot: 1, transport: "watch" });
    expect(value.capacity).toEqual({
      maxSlots: 1,
      numbered: false,
      extraStreamAvailable: false,
    });
  });

  test("an idle legacy room has no player", async () => {
    setup();
    const value = await room();
    expect(value.players).toEqual([]);
  });
});

describe("capabilities and the legacy snapshot", () => {
  test("capabilities follow the gates the rest of the remote enforces", async () => {
    setup();
    const open = await room();
    expect(open.capabilities).toMatchObject({
      listen: true,
      sports: true,
      pause: true,
      playNow: true,
      radio: true,
      tv: true,
      musicCatalog: false,
      playlists: false,
      spotifyLinks: false,
      plexPosters: false,
      lolEsports: false,
    });
    fixture.setSportsEnabled(false);
    fixture.setAdvanced(false);
    fixture.setRadioEnabled(false);
    fixture.setTvEnabled(false);
    fixture.setPlexEnabled(true);
    const closed = await room();
    expect(closed.capabilities).toMatchObject({
      sports: false,
      pause: false,
      playNow: false,
      radio: false,
      tv: false,
      plexPosters: true,
    });
  });

  test("the room is the only playback read; retired player, search and music routes are not found", async () => {
    setup();
    await fixture.seed();
    for (const path of [
      "/api/player",
      "/api/search",
      "/api/music/features",
      "/api/music/catalog",
      "/api/music/album",
      "/api/music/load",
      "/api/music/queue-match",
    ]) {
      const response = await fixture.handler(
        getRequest(fixture, path + "?guildId=" + GUILD),
      );
      expect(response.status, path).toBe(404);
      expect(ErrorSchema.parse(await response.json()).code, path).toBe(
        "not_found",
      );
    }
    const { players } = await room();
    expect(players[0]?.current?.title).toBe("Arrival");
  });
});
