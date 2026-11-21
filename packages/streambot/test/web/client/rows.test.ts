import { describe, expect, test } from "vitest";
import type { Row } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import {
  enterIntent,
  itemDetail,
  rowItem,
} from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import {
  formatTime,
  playbackPosition,
} from "@shepherdjerred/streambot/web/client/room/position.ts";
import { describeFailure } from "@shepherdjerred/streambot/web/client/messages.ts";
import { shortReference } from "@shepherdjerred/streambot/web/client/api.ts";
import {
  groupState,
  isLinkQuery,
  searchedGroups,
} from "@shepherdjerred/streambot/web/client/search/use-search.ts";

describe("Enter on a row", () => {
  test("presses the only button", () => {
    expect(enterIntent({ actions: ["watch"] })).toEqual({
      kind: "play",
      action: "watch",
    });
  });

  test("moves to the pair when there are two, with no default", () => {
    expect(enterIntent({ actions: ["watch", "listen"] })).toEqual({
      kind: "focus-actions",
    });
  });

  test("opens a browse-only row and does nothing otherwise", () => {
    expect(enterIntent({ actions: [], href: "/album/x" })).toEqual({
      kind: "open",
      href: "/album/x",
    });
    expect(enterIntent({ actions: [] })).toEqual({ kind: "none" });
  });
});

describe("rowItem", () => {
  const song: Row = {
    id: "token",
    kind: "song",
    title: "Get Lucky",
    subtitle: "Daft Punk",
    durationSeconds: 369,
    actions: ["listen", "watch"],
  };

  test("redeems a row with its shared selection and keeps its button order", () => {
    const item = rowItem(song);
    expect(item.selection).toEqual({ kind: "music", id: "token" });
    expect(item.actions).toEqual(["listen", "watch"]);
    expect(itemDetail(item)).toBe("Daft Punk · 6:09");
  });

  test("an album opens its page and plays nothing", () => {
    const item = rowItem({
      id: "MPREb",
      kind: "album",
      title: "Random Access Memories",
      actions: [],
      browse: { kind: "album", id: "MPREb" },
    });
    expect(item.selection).toBeNull();
    expect(item.href).toBe("/album/MPREb");
  });

  test("a pasted link plays its URL", () => {
    expect(
      rowItem({
        id: "https://example.com/v",
        kind: "link",
        title: "example.com/v",
        actions: ["watch", "listen"],
      }).selection,
    ).toEqual({ kind: "url", url: "https://example.com/v" });
  });
});

describe("position extrapolation", () => {
  const clock = { serverTime: 10_000, receivedAt: 50_000 };
  const base = {
    positionSeconds: 30,
    positionAt: 8000,
    paused: false,
    state: "streaming",
    current: {
      title: "x",
      durationSeconds: 100,
      mediaKind: "music" as const,
    },
  };

  test("advances by server age plus time held on this page", () => {
    // 2 s old when the snapshot was built, then held 3 s here.
    expect(playbackPosition(base, clock, 53_000)).toBe(35);
  });

  test("does not advance while paused or not streaming", () => {
    expect(playbackPosition({ ...base, paused: true }, clock, 90_000)).toBe(30);
    expect(
      playbackPosition({ ...base, state: "resolving" }, clock, 90_000),
    ).toBe(30);
  });

  test("never runs past the duration, and is unknown without a sample", () => {
    expect(playbackPosition(base, clock, 500_000)).toBe(100);
    expect(
      playbackPosition({ ...base, positionSeconds: null }, clock, 53_000),
    ).toBeNull();
  });

  test("formats minutes and hours", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(369)).toBe("6:09");
    expect(formatTime(10_871)).toBe("3:01:11");
    expect(formatTime(null)).toBe("—");
  });
});

function failure(status: number, code: string, message = "") {
  return { status, code, message, reference: "abcd1234" };
}

describe("error messages", () => {
  test("each command error code has its own words", () => {
    const codes = [
      "item_finished",
      "no_video",
      "listen_disabled",
      "listen_sports",
      "stream_limit",
      "channels_unavailable",
      "invalid_channel",
      "playback_changed",
      "channel_changed",
      "no_session",
    ];
    const texts = codes.map((code) => describeFailure(failure(409, code)).text);
    expect(new Set(texts).size).toBe(codes.length);
    expect(describeFailure(failure(409, "playback_changed")).retry).toBe(true);
    expect(describeFailure(failure(409, "listen_disabled")).retry).toBe(false);
  });

  test("feature_disabled keeps the server's specific cause", () => {
    expect(
      describeFailure(
        failure(
          403,
          "feature_disabled",
          "TV mode is not enabled in this server yet.",
        ),
      ),
    ).toEqual({
      text: "TV mode is not enabled in this server yet.",
      retry: false,
    });
  });

  test("rate limits and unreachable servers can be retried", () => {
    expect(describeFailure(failure(429, "room_stream_limit")).retry).toBe(true);
    expect(describeFailure(failure(0, "network")).retry).toBe(true);
    expect(describeFailure(failure(500, "mystery")).text).toBe(
      "Streambot could not finish this.",
    );
  });

  test("the reference is the first eight characters of a trace id", () => {
    expect(shortReference("4bf92f3577b34da6a3ce929d0e0e4736")).toBe("4bf92f35");
    expect(shortReference("not-a-trace")).toBeNull();
    expect(shortReference(null)).toBeNull();
  });
});

describe("search groups", () => {
  const capabilities = {
    listen: true,
    sports: false,
    history: true,
    radio: false,
    tv: false,
    pause: false,
    playNow: false,
    lolEsports: false,
    musicCatalog: true,
    playlists: false,
    spotifyLinks: false,
    plexPosters: false,
  };

  test("load library, songs, albums & artists, videos, then history", () => {
    expect(
      searchedGroups("daft punk", capabilities).map((group) => group.key),
    ).toEqual(["library", "songs", "albums", "videos", "history"]);
  });

  test("a pasted link searches only its own group", () => {
    expect(isLinkQuery("https://youtu.be/x")).toBe(true);
    expect(isLinkQuery("daft punk")).toBe(false);
    expect(
      searchedGroups("https://youtu.be/x", capabilities).map(
        (group) => group.title,
      ),
    ).toEqual(["Link"]);
  });

  test("a group fails as a whole and keeps a typo correction", () => {
    const row: Row = { id: "a", kind: "album", title: "A", actions: [] };
    expect(
      groupState([
        {
          ok: true,
          data: { kind: "albums", items: [row], correctedQuery: "x" },
          reference: null,
        },
        { ok: true, data: { kind: "artists", items: [] }, reference: null },
      ]),
    ).toMatchObject({
      status: "done",
      correctedQuery: "x",
      items: [{ title: "A" }],
    });
    expect(
      groupState([
        { ok: true, data: { kind: "albums", items: [row] }, reference: null },
        {
          ok: false,
          failure: {
            status: 503,
            code: "music_search_unavailable",
            message: "",
            reference: null,
          },
        },
      ]),
    ).toMatchObject({ status: "failed" });
  });
});
