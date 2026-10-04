import { expect, test } from "vitest";
import { parseYoutubeSearchLine } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";

test("flat YouTube metadata selects a supported thumbnail without resolving each result", () => {
  expect(
    parseYoutubeSearchLine(
      JSON.stringify({
        id: "QrR_gm6RqCo",
        title: "Live set",
        channel: null,
        duration: null,
        thumbnail: null,
        thumbnails: [
          { url: "https://private.example/image", width: 2000 },
          {
            url: "https://i.ytimg.com/vi/QrR_gm6RqCo/hqdefault.jpg",
            width: 480,
          },
          { url: "https://i.ytimg.com/vi/QrR_gm6RqCo/default.jpg", width: 120 },
        ],
      }),
    ),
  ).toEqual({
    title: "Live set",
    url: "https://www.youtube.com/watch?v=QrR_gm6RqCo",
    thumbnailUrl: "https://i.ytimg.com/vi/QrR_gm6RqCo/hqdefault.jpg",
  });
});

test("missing art is optional and singular unapproved art cannot bypass the array allowlist", () => {
  expect(
    parseYoutubeSearchLine(JSON.stringify({ id: "a", title: "Talk" })),
  ).toEqual({ title: "Talk", url: "https://www.youtube.com/watch?v=a" });
  expect(
    parseYoutubeSearchLine(
      JSON.stringify({
        id: "a",
        title: "Talk",
        thumbnail: "https://internal.example/private",
      }),
    ),
  ).not.toHaveProperty("thumbnailUrl");
});
