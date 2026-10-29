import { expect, test } from "vitest";
import { PlexClient } from "#integrations/plex.ts";
import {
  archiveInventory,
  archiveInventoryPass,
  videoSections,
} from "./inventory.ts";

function client(pages: unknown[]) {
  let calls = 0;
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.invalid",
      token: "synthetic",
      clientIdentifier: "archive-test",
    },
    async () => {
      const page = pages[calls++];
      if (page === undefined) throw new Error("Unexpected Plex request");
      return Response.json(page);
    },
  );
  return { plex, calls: () => calls };
}
function item(key: string, path: string) {
  return {
    ratingKey: key,
    type: "movie",
    title: "Private title not retained",
    Guid: [{ id: "tmdb://123" }],
    Media: [{ Part: [{ id: 1, file: path, size: 42 }] }],
  };
}
const request = { sectionId: "1", kind: "movie" as const };
test("complete actual Plex pages produce identity-only digest independent of returned order", async () => {
  const a = item("1", "/data/movies/A.mkv"),
    b = item("2", "/data/movies/B.mkv");
  const first = client([
    { MediaContainer: { size: 1, totalSize: 2, Metadata: [a] } },
    { MediaContainer: { size: 1, totalSize: 2, Metadata: [b] } },
  ]);
  const second = client([
    { MediaContainer: { size: 2, totalSize: 2, Metadata: [b, a] } },
  ]);
  const proof = await archiveInventory(
    first.plex,
    request,
    new AbortController().signal,
  );
  expect(first.calls()).toBe(2);
  expect(proof.items).toHaveLength(2);
  const reordered = await archiveInventory(
    second.plex,
    request,
    new AbortController().signal,
  );
  expect(proof.digest).toBe(reordered.digest);
});
test.each(["changed", "duplicate", "missing-part", "oversized"])(
  "%s inventory cannot prove archive absence",
  async (mode) => {
    const a = item("1", "/data/movies/A.mkv");
    const pages =
      mode === "missing-part"
        ? [
            {
              MediaContainer: {
                size: 1,
                totalSize: 1,
                Metadata: [{ ratingKey: "1", type: "movie", title: "Unknown" }],
              },
            },
          ]
        : [
            {
              MediaContainer: {
                size: 1,
                totalSize: mode === "oversized" ? 10_001 : 2,
                Metadata: [a],
              },
            },
            {
              MediaContainer: {
                size: 1,
                totalSize: mode === "changed" ? 3 : 2,
                Metadata: [a],
              },
            },
          ];
    await expect(
      archiveInventory(
        client(pages).plex,
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  },
);

test("video sections reject duplicate identities and the explicit section bound", () => {
  expect(() =>
    videoSections([
      { key: "1", type: "movie" },
      { key: "1", type: "show" },
    ]),
  ).toThrow();
  expect(() =>
    videoSections(
      Array.from({ length: 101 }, (_, index) => ({
        key: String(index),
        type: "movie",
      })),
    ),
  ).toThrow();
  expect(
    videoSections([
      { key: "music", type: "artist" },
      { key: "2", type: "show" },
      { key: "1", type: "movie" },
    ]),
  ).toEqual([
    { sectionId: "1", kind: "movie" },
    { sectionId: "2", kind: "episode" },
  ]);
});
test("complete pass rejects global item overflow even when each section is individually bounded", async () => {
  const sections = videoSections([
    { key: "1", type: "movie" },
    { key: "2", type: "movie" },
  ]);
  const plex = {
    libraryPage: (input: {
      sectionId: string;
      offset: number;
      limit?: number;
    }) =>
      Promise.resolve({
        total: 5001,
        items: Array.from(
          { length: Math.min(input.limit ?? 200, 5001 - input.offset) },
          (_, index) =>
            item(
              `${input.sectionId}-${String(input.offset + index)}`,
              `/data/movies/${input.sectionId}-${String(input.offset + index)}.mkv`,
            ),
        ),
      }),
  };
  await expect(
    archiveInventoryPass(
      plex,
      sections,
      new Set(),
      new AbortController().signal,
    ),
  ).rejects.toThrow("Archive Plex evidence");
});
