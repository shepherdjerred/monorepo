import { expect, it } from "vitest";
import { TautulliPlaybackClient } from "./tautulli-playback.ts";

it("reads genuine ungrouped historical API rows without leaking the key or current activity", async () => {
  const client = new TautulliPlaybackClient(
    { baseUrl: "https://tautulli.example", apiKey: "test-only" },
    async (url, init) => {
      expect(url.searchParams.get("grouping")).toBe("0");
      expect(url.searchParams.get("include_activity")).toBe("0");
      expect(url.searchParams.has("apikey")).toBe(false);
      expect(new Headers(init.headers).get("X-Api-Key")).toBe("test-only");
      return Response.json({
        response: {
          result: "success",
          data: {
            recordsTotal: 1,
            recordsFiltered: 1,
            data: [
              {
                row_id: 7,
                user_id: 123,
                rating_key: "42",
                started: 1000,
                stopped: 2000,
                play_duration: 900,
                percent_complete: 85,
                full_title: "Pilot",
                grandparent_title: "Series",
                media_type: "episode",
                platform: "tvOS",
                player: "Apple TV",
                transcode_decision: "copy",
              },
            ],
          },
        },
      });
    },
  );
  const page = await client.historyPage({
    offset: 0,
    limit: 100,
    through: new Date(3_000_000),
  });
  expect(page.rows[0]).toMatchObject({
    id: "7",
    user_id: "123",
    duration: 900,
    percent_complete: 85,
    transcode_decision: "direct_stream",
  });
});
