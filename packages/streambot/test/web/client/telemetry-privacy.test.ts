import { describe, expect, test } from "vitest";
import type { CaptureResult } from "posthog-js";
import type { ErrorEvent } from "@sentry/react";
import {
  errorShownEvent,
  pageViewEvent,
  playButton,
  rankBucket,
  resultChosenEvent,
} from "@shepherdjerred/streambot/web/client/telemetry/events.ts";
import {
  replayAttribute,
  routePattern,
  sanitizeUrl,
  trackingAllowed,
} from "@shepherdjerred/streambot/web/client/telemetry/privacy.ts";
import {
  analyticsConfig,
  sanitizeCapture,
} from "@shepherdjerred/streambot/web/client/telemetry/posthog-config.ts";
import {
  scrubBreadcrumb,
  scrubErrorEvent,
} from "@shepherdjerred/streambot/web/client/telemetry/scrub.ts";

const SITE = "https://streambot.sjer.red";
const ANALYTICS_ID = "8d0f6c1e-3b9a-4c55-9f53-2f7f8c3a9b10";

// Everything a payload must never carry.
const TITLE = "Bohemian Rhapsody Private Title";
const QUERY = "my secret search";
const MEDIA_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const USERNAME = "jerred_private_name";
const GUILD_NAME = "Jerred Private Guild";
const CHANNEL_NAME = "Secret Voice Channel";
const USER_ID = "100000000000000001";
const GUILD_ID = "100000000000000010";
const CHANNEL_ID = "100000000000000020";
const ALBUM_ID = "MPREb_privateAlbumId";
const DSN_KEY = "fixture-dsn-public-key";
const FAKE_DSN = `https://${DSN_KEY}@errors.example.test/42`;
const PRIVATE = [
  TITLE,
  QUERY,
  encodeURIComponent(QUERY),
  "my+secret+search",
  MEDIA_URL,
  "dQw4w9WgXcQ",
  USERNAME,
  GUILD_NAME,
  CHANNEL_NAME,
  USER_ID,
  GUILD_ID,
  CHANNEL_ID,
  ALBUM_ID,
  DSN_KEY,
  FAKE_DSN,
];

function expectClean(payload: unknown): void {
  const haystack = JSON.stringify(payload);
  for (const value of PRIVATE) expect(haystack).not.toContain(value);
}

const pageUrl = `${SITE}/album/${ALBUM_ID}?q=${encodeURIComponent(QUERY)}&src=${encodeURIComponent(MEDIA_URL)}`;

/** What PostHog would assemble on its own for a page view, a click and web vitals. */
function automaticCapture(event: string): CaptureResult {
  return {
    uuid: "0190a8c4-0000-7000-8000-000000000000",
    event,
    properties: {
      $current_url: pageUrl,
      $pathname: `/album/${ALBUM_ID}`,
      $host: "streambot.sjer.red",
      $referrer: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}?name=${encodeURIComponent(CHANNEL_NAME)}`,
      $referring_domain: "discord.com",
      $prev_pageview_pathname: `/playlists/${ALBUM_ID}`,
      title: `Search: ${QUERY} · Streambot`,
      $el_text: TITLE,
      $external_click_url: MEDIA_URL,
      $heatmap_data: { [pageUrl]: [{ x: 1, y: 2 }] },
      $web_vitals_LCP_event: {
        name: "LCP",
        value: 1200,
        $current_url: pageUrl,
        attribution: { url: `https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg` },
      },
      $network_request: `https://errors.example.test/api/42/envelope/?sentry_key=${DSN_KEY}`,
      route: "/album/:id",
    },
    $set_once: {
      $initial_current_url: pageUrl,
      $initial_pathname: `/album/${ALBUM_ID}`,
      $initial_referrer: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    },
    $set: { $current_url: pageUrl },
  };
}

describe("route patterns", () => {
  test.each([
    ["/", "/"],
    [`/?q=${QUERY}`, "/"],
    ["/library", "/library"],
    ["/playlists", "/playlists"],
    [`/playlists/${ALBUM_ID}`, "/playlists/:id"],
    [`/album/${ALBUM_ID}`, "/album/:id"],
    [`/artist/${ALBUM_ID}/`, "/artist/:id"],
    [`/nowhere/${ALBUM_ID}`, "/other"],
  ])("%s reports as %s", (path, pattern) => {
    expect(routePattern(path)).toBe(pattern);
  });

  test("URLs keep this site's origin and pattern, or only another site's origin", () => {
    expect(sanitizeUrl(pageUrl, SITE)).toBe(SITE + "/album/:id");
    expect(sanitizeUrl(MEDIA_URL, SITE)).toBe("https://www.youtube.com");
    expect(sanitizeUrl("not a url", SITE)).toBe("");
  });
});

describe("closed event properties", () => {
  test("rank buckets and play buttons are small closed sets", () => {
    expect(
      [undefined, 0, 1, 2, 3, 4, 10, 11, 99].map((rank) => rankBucket(rank)),
    ).toEqual([
      "none",
      "none",
      "1",
      "2-3",
      "2-3",
      "4-10",
      "4-10",
      "11+",
      "11+",
    ]);
    expect(playButton(false, { transport: "listen", placement: "queue" })).toBe(
      "listen",
    );
    expect(playButton(false, { transport: "watch", placement: "queue" })).toBe(
      "watch",
    );
    expect(playButton(true, { transport: "listen", placement: "next" })).toBe(
      "listen_next",
    );
    expect(playButton(true, { transport: "watch", placement: "now" })).toBe(
      "watch_now",
    );
    expect(playButton(true, { transport: "watch", placement: "queue" })).toBe(
      "watch_video",
    );
    expect(playButton(true, { transport: "listen", placement: "queue" })).toBe(
      "listen_only",
    );
    expect(
      playButton(true, {
        transport: "watch",
        placement: "queue",
        anotherStream: true,
      }),
    ).toBe("another_stream");
  });

  test("unknown failure codes report as other", () => {
    expect(errorShownEvent({ code: "no_voice" }, "row").properties).toEqual({
      code: "no_voice",
      surface: "row",
    });
    expect(
      errorShownEvent({ code: `bad ${TITLE}` }, "search").properties,
    ).toEqual({ code: "other", surface: "search" });
  });
});

describe("no private value reaches a payload", () => {
  test("a search, a play from its results and its failure", () => {
    const events = [
      pageViewEvent(`/?q=${QUERY}`, SITE),
      pageViewEvent(`/album/${ALBUM_ID}`, SITE),
      resultChosenEvent(
        { kind: "song", rank: 2 },
        playButton(true, { transport: "watch", placement: "queue" }),
      ),
      errorShownEvent({ code: `music_query ${QUERY}` }, "search"),
    ];
    expectClean(events);
    expect(events[1]).toEqual({
      event: "$pageview",
      properties: {
        $current_url: SITE + "/album/:id",
        $pathname: "/album/:id",
        route: "/album/:id",
      },
    });
    expect(events[2]?.properties).toEqual({
      kind: "song",
      rank_bucket: "2-3",
      button: "watch_video",
    });
  });

  test("PostHog's automatic properties are sanitized before sending", () => {
    for (const event of ["$pageview", "$autocapture", "$web_vitals"]) {
      const sanitized = sanitizeCapture(automaticCapture(event), SITE);
      expectClean(sanitized);
      expect(sanitized?.properties["$current_url"]).toBe(SITE + "/album/:id");
      expect(sanitized?.properties["$pathname"]).toBe("/album/:id");
      expect(sanitized?.properties["$referrer"]).toBe("https://discord.com");
      expect(sanitized?.properties["$heatmap_data"]).toEqual({
        [SITE + "/album/:id"]: [{ x: 1, y: 2 }],
      });
      expect(sanitized?.$set_once?.["$initial_pathname"]).toBe("/album/:id");
    }
    expect(sanitizeCapture(null, SITE)).toBeNull();
  });

  test("replay masks text, inputs, labels and recorded addresses", () => {
    const config = analyticsConfig(ANALYTICS_ID, SITE);
    expect(config.session_recording?.maskTextSelector).toBe("*");
    expect(config.session_recording?.maskAllInputs).toBe(true);
    expect(config.mask_all_text).toBe(true);
    expect(config.mask_all_element_attributes).toBe(true);
    expect(config.capture_performance).toEqual({
      web_vitals: true,
      network_timing: false,
    });
    expect(config.api_host).toBe("https://j.sjer.red");
    expect(config.bootstrap?.distinctID).toBe(ANALYTICS_ID);
    const mask = config.session_recording?.maskCapturedNetworkRequestFn;
    if (mask === undefined || mask === null)
      throw new Error("Replay must mask recorded addresses");
    const timing = {
      duration: 1,
      entryType: "resource" as const,
      startTime: 0,
    };
    const masked = [
      mask({ ...timing, name: pageUrl }),
      mask({
        ...timing,
        name: `https://errors.example.test/api/42/envelope/?sentry_key=${DSN_KEY}`,
      }),
    ];
    expect(masked.map((request) => request?.name)).toEqual([
      SITE + "/album/:id",
      "https://errors.example.test",
    ]);
    expect(replayAttribute("aria-label", `More ways to play ${TITLE}`)).toBe(
      "",
    );
    expect(replayAttribute("href", `/album/${ALBUM_ID}`)).toBe("");
    expect(replayAttribute("class", "btn btn-listen")).toBe("btn btn-listen");
    expectClean([masked, config.bootstrap]);
  });

  test("error reports drop query strings and labelled click text, and carry the Reference", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: `Failed ${SITE}/api/search/v2?q=${encodeURIComponent(QUERY)}`,
      request: {
        url: pageUrl,
        query_string: `q=${QUERY}`,
        headers: { Referer: pageUrl },
      },
      exception: {
        values: [
          {
            type: "TypeError",
            value: `Cannot read /api/music/v2/album?id=${ALBUM_ID}&src=${encodeURIComponent(MEDIA_URL)}`,
          },
        ],
      },
      breadcrumbs: [
        {
          category: "ui.click",
          message: `button[aria-label="More ways to play ${TITLE}"]`,
        },
        {
          category: "navigation",
          data: { from: "/", to: `/?q=${encodeURIComponent(QUERY)}` },
        },
        {
          category: "fetch",
          data: {
            url: `/api/search/v2?guildId=${GUILD_ID}&q=${encodeURIComponent(QUERY)}`,
            status_code: 200,
          },
        },
        {
          category: "console",
          message: `Streambot response did not match its contract /api/search/v2?q=${encodeURIComponent(QUERY)}`,
          data: { arguments: [QUERY], logger: "console" },
        },
      ],
    };
    const scrubbed = scrubErrorEvent(event, "4bf92f35", SITE);
    expectClean(scrubbed);
    expect(scrubbed.tags).toEqual({ reference: "4bf92f35" });
    expect(scrubbed.request).toEqual({ url: SITE + "/album/:id" });
    expect(scrubbed.breadcrumbs?.[1]?.data).toEqual({ from: "/", to: "/" });
    expect(scrubbed.breadcrumbs?.[2]?.data?.["url"]).toBe("/api/search/v2");
    expect(scrubErrorEvent(event, null, SITE).tags).toBeUndefined();
    expectClean(
      event.breadcrumbs?.map((breadcrumb) => scrubBreadcrumb(breadcrumb)),
    );
  });
});

test("Do Not Track and Global Privacy Control turn analytics off", () => {
  const none = {
    doNotTrack: null,
    windowDoNotTrack: undefined,
    globalPrivacyControl: undefined,
  };
  expect(trackingAllowed(none)).toBe(true);
  expect(trackingAllowed({ ...none, doNotTrack: "1" })).toBe(false);
  expect(trackingAllowed({ ...none, windowDoNotTrack: "1" })).toBe(false);
  expect(trackingAllowed({ ...none, globalPrivacyControl: true })).toBe(false);
});
