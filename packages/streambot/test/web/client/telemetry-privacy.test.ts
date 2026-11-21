import { describe, expect, test } from "vitest";
import type { CaptureResult } from "posthog-js";
import type { ErrorEvent } from "@sentry/react";
import { z } from "zod";
import { WEB_API_ERROR_CODES } from "@shepherdjerred/streambot/web/shared/error-codes.ts";
import { RowActionSchema } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import {
  errorCode,
  errorShownEvent,
  offered,
  pageViewEvent,
  playButton,
  rankBucket,
  resultChosenEvent,
} from "@shepherdjerred/streambot/web/client/telemetry/events.ts";
import {
  replayAttribute,
  routePattern,
  sanitizeElementsChain,
  sanitizeHref,
  sanitizeUrl,
  productionHost,
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
  test("offered names which of Listen and Watch the row showed", () => {
    expect(
      [[], ["listen"], ["watch"], ["watch", "listen"]].map((actions) =>
        offered(z.array(RowActionSchema).parse(actions)),
      ),
    ).toEqual(["none", "listen", "watch", "both"]);
  });

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

  test("failure codes come from the shared API contract plus the client's own", () => {
    for (const code of WEB_API_ERROR_CODES) expect(errorCode(code)).toBe(code);
    for (const code of ["no_voice", "network", "bad_response", "queue_changed"])
      expect(errorCode(code)).toBe(code);
    for (const code of ["", "aborted", "NOT_FOUND", `not_found ${QUERY}`])
      expect(errorCode(code)).toBe("other");
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
        { kind: "song", rank: 2, actions: ["listen"] },
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
      offered: "listen",
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

  test("autocapture shapes lose link targets, text and labels, and relative URLs lose their query", () => {
    const chain =
      `a.row-link.btn:attr__class="row-link btn"attr__href="/album/${ALBUM_ID}?q=${encodeURIComponent(QUERY)}"` +
      `attr__aria-label="More ways to play ${TITLE}"href="/library?series=${encodeURIComponent(TITLE)}"` +
      `nth-child="2"nth-of-type="1"text="${TITLE}"attr_id="${USER_ID}";li.row:nth-child="3"nth-of-type="3"`;
    const capture: CaptureResult = {
      uuid: "0190a8c4-0000-7000-8000-000000000001",
      event: "$autocapture",
      properties: {
        $current_url: `/library?series=${encodeURIComponent(TITLE)}`,
        $elements_chain: chain,
        $elements: [
          {
            tag_name: "a",
            $el_text: TITLE,
            text: TITLE,
            attr__href: `/album/${ALBUM_ID}?q=${encodeURIComponent(QUERY)}`,
            "attr__aria-label": `More ways to play ${TITLE}`,
            attr_id: USER_ID,
            attributes: { "attr__aria-label": TITLE },
            classes: ["row-link"],
            nth_child: 2,
          },
        ],
        attr__href: `?q=${encodeURIComponent(QUERY)}`,
        $prev_pageview_pathname: `/playlists/${ALBUM_ID}?sort=${encodeURIComponent(TITLE)}`,
        $exception_message: `Failed at /api/search/v2?q=${encodeURIComponent(QUERY)} for row`,
      },
    };
    const sanitized = sanitizeCapture(capture, SITE);
    expectClean(sanitized);
    expect(sanitized?.properties["$current_url"]).toBe("/library");
    expect(sanitized?.properties["$elements_chain"]).toBe(
      'a.row-link.btn:attr__class="row-link btn"attr__href="/album/:id"href="/library"nth-child="2"nth-of-type="1";li.row:nth-child="3"nth-of-type="3"',
    );
    expect(sanitized?.properties["$elements"]).toEqual([
      {
        tag_name: "a",
        attr__href: "/album/:id",
        classes: ["row-link"],
        nth_child: 2,
      },
    ]);
    expect(sanitized?.properties["attr__href"]).toBe("");
    expect(sanitized?.properties["$prev_pageview_pathname"]).toBe(
      "/playlists/:id",
    );
    expect(sanitized?.properties["$exception_message"]).toBe(
      "Failed at /api/search/v2 for row",
    );
    expect(sanitizeHref(`?q=${QUERY}`, SITE)).toBe("");
    expect(sanitizeHref(`#${QUERY}`, SITE)).toBe("");
    expect(sanitizeHref(`album/${ALBUM_ID}?q=x`, SITE)).toBe(
      SITE + "/album/:id",
    );
    expect(sanitizeHref(MEDIA_URL, SITE)).toBe("https://www.youtube.com");
    expect(sanitizeElementsChain('button.btn:nth-child="1"', SITE)).toBe(
      'button.btn:nth-child="1"',
    );
  });

  test("autocapture, rage clicks, dead clicks and heatmaps are off; page views stay manual", () => {
    const config = analyticsConfig(ANALYTICS_ID, SITE);
    expect(config.autocapture).toBe(false);
    expect(config.rageclick).toBe(false);
    expect(config.capture_dead_clicks).toBe(false);
    expect(config.capture_heatmaps).toBe(false);
    expect(config.capture_pageview).toBe(false);
  });
});

describe("replay and error reports carry no private value", () => {
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
    for (const href of [
      `/album/${ALBUM_ID}`,
      `/library?series=${encodeURIComponent(TITLE)}`,
      `${SITE}/?q=${encodeURIComponent(QUERY)}`,
      MEDIA_URL,
    ]) {
      expect(replayAttribute("href", href)).toBe("");
      expect(replayAttribute("HREF", href)).toBe("");
    }
    expect(replayAttribute("src", MEDIA_URL)).toBe("");
    expect(replayAttribute("alt", TITLE)).toBe("");
    expect(replayAttribute("data-key", ALBUM_ID)).toBe("");
    expect(replayAttribute("class", "btn btn-listen")).toBe("btn btn-listen");
    // rrweb's inlined app stylesheet and layout metadata keep replay rendering.
    expect(replayAttribute("_cssText", ".btn{color:red}")).toBe(
      ".btn{color:red}",
    );
    expect(replayAttribute("rr_width", "120px")).toBe("120px");
    expect(replayAttribute("rr_src", MEDIA_URL)).toBe("");
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

test("the tracker loads only on the registered production host", () => {
  expect(productionHost("streambot.sjer.red", "streambot.sjer.red")).toBe(true);
  for (const host of [
    "127.0.0.1:5291",
    "localhost:5187",
    "streambot.sjer.red:8443",
    "preview.streambot.sjer.red",
    "streambot.sjer.red.example.com",
  ])
    expect(productionHost(host, "streambot.sjer.red")).toBe(false);
});
