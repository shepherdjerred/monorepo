import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { fileSize, fileSummary, subtitleName } from "./files.tsx";
import { InRouter } from "#client/in-router.test-support.tsx";
import { Hero } from "./hero.tsx";
import { TitleSkeleton } from "./states.tsx";

const art = {
  posterPath: "/poster123.jpg",
  backdropPath: "/backdrop12.jpg",
};

function hero(artwork: typeof art | { posterPath: null; backdropPath: null }) {
  return renderToStaticMarkup(
    <InRouter>
      <Hero
        title="Dune: Part Two"
        artwork={artwork}
        meta={["Film", "2024"]}
        state={{ label: "Ready to watch", tone: "ok" }}
        overview="Paul Atreides unites with the Fremen."
      >
        <button type="button">Request</button>
      </Hero>
    </InRouter>,
  );
}

test("only the backdrop is fetched at high priority, and neither image waits", () => {
  const html = hero(art);
  const images = html.match(/<img[^>]*>/gu) ?? [];
  expect(images).toHaveLength(2);
  const [backdrop, poster] = images;
  expect(backdrop).toContain('fetchPriority="high"');
  expect(backdrop).toContain(
    'srcSet="/api/v1/artwork/w780/backdrop12.jpg 780w, /api/v1/artwork/w1280/backdrop12.jpg 1280w"',
  );
  // Sized, so the band is laid out before the picture arrives.
  expect(backdrop).toContain('width="1280" height="720"');
  expect(backdrop).not.toContain("loading=");
  expect(poster).toContain('loading="eager"');
  expect(poster).not.toContain("fetchPriority");
  expect(poster).toContain("/api/v1/artwork/w342/poster123.jpg");
  // Both are decoration beside the title's own text.
  expect(html.match(/alt=""/gu)).toHaveLength(2);
});

test("a title with no artwork keeps its frames and shows no broken image", () => {
  const html = hero({ posterPath: null, backdropPath: null });
  expect(html).not.toContain("<img");
  expect(html).toContain("Dune: Part Two");
});

test("the hero names the title once as the page heading and sets the tab title", () => {
  const html = hero(art);
  expect(html.match(/<h1/gu)).toHaveLength(1);
  expect(html).toContain("<title>Dune: Part Two · Media</title>");
  expect(html).toContain("Ready to watch");
  // Facts are separate items, not one string joined with dots.
  expect(html).toContain("<li>Film</li><li>2024</li>");
});

test("a file is described by its picture, sound and size", () => {
  expect(
    fileSummary(
      {
        quality: "Remux-2160p",
        hdr: true,
        audioLanguages: ["en", "fr"],
        sizeBytes: 71_342_556_160,
        codec: "hevc",
      },
      "en-US",
    ),
  ).toEqual(["Remux-2160p, HDR", "English, French audio", "71.3 GB"]);
  expect(
    fileSummary({ quality: "Bluray-1080p", qualityFallback: true }, "en-US"),
  ).toEqual(["Bluray-1080p", "Fallback copy"]);
  expect(fileSummary({}, "en-US")).toEqual([]);
  expect(fileSummary("not an object", "en-US")).toEqual([]);
  expect(fileSize(8_214_663_168, "en-US")).toBe("8.2 GB");
});

test("a subtitle is named by its language and what kind it is", () => {
  const plain = { language: "en", forced: false, hearingImpaired: false };
  expect(subtitleName(plain)).toBe("English");
  expect(subtitleName({ ...plain, forced: true })).toBe(
    "English, foreign dialogue only",
  );
  expect(subtitleName({ ...plain, hearingImpaired: true })).toBe(
    "English, with sound descriptions",
  );
  expect(subtitleName({ ...plain, language: "zh-Hans" })).toBe(
    "Chinese (Simplified)",
  );
});

test("a page opened from a poster card shows that poster while it loads", () => {
  const opened = renderToStaticMarkup(
    <InRouter
      address="/media/abc"
      state={{ openedPoster: { path: "/poster123.jpg", title: "Dune" } }}
    >
      <TitleSkeleton />
    </InRouter>,
  );
  expect(opened).toContain("/api/v1/artwork/w342/poster123.jpg");
  // Opened from anywhere else, it holds the place with a block.
  const direct = renderToStaticMarkup(
    <InRouter address="/media/abc">
      <TitleSkeleton />
    </InRouter>,
  );
  expect(direct).not.toContain("<img");
});
