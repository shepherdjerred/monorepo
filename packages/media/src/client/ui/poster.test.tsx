import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ArtworkFileSchema, ArtworkSizeSchema } from "#shared/artwork/proxy.ts";
import { artworkUrl } from "./artwork.ts";
import { InRouter } from "#client/in-router.test-support.tsx";
import { Poster } from "./poster.tsx";
import { PosterCard } from "./poster-card.tsx";
import { readEveryPage } from "./use-cursor-list.ts";

test("an artwork address is one the proxy route accepts", () => {
  const url = artworkUrl("w342", "/kqjL17yufvn9OVLyXYpvtyrFfak.jpg");
  expect(url).toBe("/api/v1/artwork/w342/kqjL17yufvn9OVLyXYpvtyrFfak.jpg");
  const [size, file] = url.split("/").slice(-2);
  expect(ArtworkSizeSchema.safeParse(size).success).toBe(true);
  expect(ArtworkFileSchema.safeParse(file).success).toBe(true);
});

test("a poster is a lazy, sized image the browser can pick a width for", () => {
  const html = renderToStaticMarkup(
    <Poster path="/abcdefgh.jpg" title="Dune" sizes="160px" />,
  );
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('alt=""');
  expect(html).toContain('sizes="160px"');
  expect(html).toContain('width="342" height="513"');
  expect(html).toContain(
    'srcSet="/api/v1/artwork/w185/abcdefgh.jpg 185w, /api/v1/artwork/w342/abcdefgh.jpg 342w, /api/v1/artwork/w500/abcdefgh.jpg 500w"',
  );
});

test("a title with no poster shows its name, not an image", () => {
  const html = renderToStaticMarkup(
    <Poster path={null} title="Blade Runner 2049" sizes="160px" />,
  );
  expect(html).not.toContain("<img");
  expect(html).toContain("Blade Runner 2049");
  // The card beside it already names the title to a screen reader.
  expect(html).toContain('aria-hidden="true"');
});

test("a poster card is one link that names the title and its state", () => {
  const html = renderToStaticMarkup(
    <InRouter>
      <PosterCard
        to="/media/abc"
        title="Severance"
        detail="Series, 2022"
        posterPath={null}
        state={{ label: "3 of 10 episodes", tone: "progress" }}
      />
    </InRouter>,
  );
  expect(html.match(/<a /gu)).toHaveLength(1);
  expect(html).toContain('href="/media/abc"');
  expect(html).toContain('data-tone="progress"');
  expect(html).toContain("<h2");
});

test("reading every page follows each cursor once and stops at the last", async () => {
  const asked: (string | null)[] = [];
  const pages = new Map<
    string | null,
    { items: number[]; nextCursor: string | null }
  >([
    [null, { items: [1, 2], nextCursor: "a" }],
    ["a", { items: [], nextCursor: "b" }],
    ["b", { items: [3], nextCursor: null }],
  ]);
  const all = await readEveryPage((cursor) => {
    asked.push(cursor);
    const page = pages.get(cursor);
    if (page === undefined) throw new Error("unexpected cursor");
    return Promise.resolve(page);
  });
  expect(asked).toEqual([null, "a", "b"]);
  expect(all).toEqual({ items: [1, 2, 3], nextCursor: null });
});

test("a cursor that never ends is an error, not an endless read", async () => {
  await expect(
    readEveryPage(() => Promise.resolve({ items: [1], nextCursor: "again" })),
  ).rejects.toThrow("did not end within 100 pages");
});
