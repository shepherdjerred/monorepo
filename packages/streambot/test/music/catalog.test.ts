import { expect, test, vi } from "vitest";
import { MusicCatalog } from "@shepherdjerred/streambot/music/catalog.ts";

const signal = new AbortController().signal;

test("catalog HTTP failures surface a typed, user-facing error", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 503 }));
  const catalog = new MusicCatalog(fetcher);

  await expect(
    catalog.browse(
      new URLSearchParams({ query: "Radiohead", type: "artist" }),
      signal,
    ),
  ).rejects.toMatchObject({
    name: "MusicError",
    status: 503,
    code: "catalog_unavailable",
    message: "Music catalog is unavailable. Try again shortly.",
  });
});

test("an unavailable album edition surfaces a typed not-found error", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        title: "Album",
        "artist-credit": [{ name: "Artist" }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        releases: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Album",
          },
        ],
      }),
    );
  const catalog = new MusicCatalog(fetcher);

  await expect(
    catalog.album(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      signal,
    ),
  ).rejects.toMatchObject({
    name: "MusicError",
    status: 404,
    code: "album_edition",
    message: "This album edition is unavailable.",
  });
});
