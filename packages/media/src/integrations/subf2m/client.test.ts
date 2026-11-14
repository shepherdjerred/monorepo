import { expect, test } from "vitest";
import { Subf2mProvider } from "./client.ts";
import type { SubtitleScoreReferenceV1 } from "#shared/subtitle-maintenance/score.ts";
const reference: SubtitleScoreReferenceV1 = {
  schemaVersion: 1,
  kind: "movie",
  title: "Example",
  year: 2026,
  season: null,
  episode: null,
  sourceFilename: "Example.2026.mkv",
  quality: null,
  videoCodec: null,
  audioCodec: null,
  imdbId: "tt12345",
  tmdbId: null,
  edition: "default",
};
const listing = (imdb = "tt12345") =>
  `<div class="header"><h2><a href="https://www.imdb.com/title/${imdb}/">IMDb</a></h2></div><li class="item"><a class="download icon-download" href="/subtitles/example/english/123"></a><ul class="scrolllist"><li>Example.2026.1080p.BluRay-GROUP</li></ul><div class="comment-col"><p>Human translation</p></div></li>`;
test("native current listing preserves real release names and fallback identity", async () => {
  const calls: string[] = [];
  const client = new Subf2mProvider(async (input) => {
    calls.push(String(input));
    return new Response(
      calls.length === 1
        ? '<li><div class="title"><a href="/subtitles/example">Example (2026) (2026)</a></div></li>'
        : listing(),
    );
  });
  await expect(client.search(reference)).resolves.toEqual([
    {
      page: "/subtitles/example/english/123",
      release: "Example.2026.1080p.BluRay-GROUP",
      description: "Human translation",
    },
  ]);
  expect(calls).toHaveLength(2);
});
test("a different actual IMDb listing is excluded", async () => {
  let count = 0;
  const client = new Subf2mProvider(
    async () =>
      new Response(
        ++count === 1
          ? '<li><div class="title"><a href="/subtitles/example">Example (2026)</a></div></li>'
          : listing("tt99999"),
      ),
  );
  await expect(client.search(reference)).resolves.toEqual([]);
});
test("TV season names and numbers are exact, without guessing another season", async () => {
  const calls: string[] = [];
  const client = new Subf2mProvider(async (input) => {
    calls.push(String(input));
    return new Response(
      calls.length === 1
        ? '<li><div class="title"><a href="/subtitles/example-three">Example - Season 3</a><a href="/subtitles/example-two">Example - Second Season</a></div></li>'
        : listing(),
    );
  });
  expect(
    await client.search({
      ...reference,
      kind: "episode",
      season: 3,
      episode: 2,
    }),
  ).toHaveLength(1);
  expect(calls[1]).toContain("example-three/english");
});
test("challenge and cross-origin downloads fail explicitly without downloading", async () => {
  await expect(
    new Subf2mProvider(
      async () => new Response("<html>Just a moment cf-chl-token</html>"),
    ).search(reference),
  ).rejects.toMatchObject({ kind: "interaction-required" });
  let calls = 0;
  const client = new Subf2mProvider(async () => {
    calls += 1;
    return new Response(
      '<a id="downloadButton" href="https://attacker.invalid/subtitles/archive">Download</a>',
    );
  });
  await expect(
    client.download("/subtitles/example/english/123"),
  ).rejects.toMatchObject({ kind: "invalid-response" });
  expect(calls).toBe(1);
});
