import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import {
  ManageLayout,
  revealCurrentSection,
  type ScrollableSectionRow,
} from "./layout.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferredFontReady() {
  let settle!: () => void;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  vi.stubGlobal("document", { fonts: { ready } });
  return { ready, settle };
}

function sectionRow(
  href: string,
  contentRect: () => { left: number; width: number },
  viewportWidth = 390,
): ScrollableSectionRow {
  const row: ScrollableSectionRow = {
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, right: viewportWidth }),
    querySelector: (selector) => {
      if (selector !== `a[href="${href}"]`) return null;
      return {
        getBoundingClientRect: () => {
          const { left, width } = contentRect();
          const viewportLeft = left - row.scrollLeft;
          return { left: viewportLeft, right: viewportLeft + width };
        },
      };
    },
  };
  return row;
}

test("marks the active Manage section in the rail", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/manage/subtitles/replacements/abc"]}>
      <Routes>
        <Route path="/manage/*" element={<ManageLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  const current = [
    ...html.matchAll(/<a [^>]*aria-current="page"[^>]*href="([^"]+)"/gu),
  ];
  expect(current.map((match) => match[1])).toEqual(["/manage/subtitles"]);
});

test("recomputes scrollLeft after document.fonts.ready when link geometry shifts", async () => {
  const fonts = deferredFontReady();
  let linkLeft = 520;
  const row = sectionRow("/manage/migration", () => ({
    left: linkLeft,
    width: 90,
  }));

  revealCurrentSection(row, "/manage/migration");
  expect(row.scrollLeft).toBe(504);

  // Self-hosted fonts widen preceding pills; the post-font offset matches a
  // fresh render where fonts were already loaded (`544 - 16 = 528`).
  linkLeft = 544;
  fonts.settle();
  await fonts.ready;
  expect(row.scrollLeft).toBe(528);
});

test("scrolls a borderline section once fonts push its trailing edge past 390px", async () => {
  const fonts = deferredFontReady();
  let width = 70;
  const row = sectionRow("/manage/plex", () => ({ left: 315, width }));

  revealCurrentSection(row, "/manage/plex");
  expect(row.scrollLeft).toBe(0);

  width = 86;
  fonts.settle();
  await fonts.ready;
  expect(row.scrollLeft).toBe(299);
});

test("stops waiting on document.fonts.ready when the effect cleans up", async () => {
  const fonts = deferredFontReady();
  let linkLeft = 520;
  const row = sectionRow("/manage/migration", () => ({
    left: linkLeft,
    width: 90,
  }));

  const cleanup = revealCurrentSection(row, "/manage/migration");
  expect(row.scrollLeft).toBe(504);

  cleanup?.();
  linkLeft = 560;
  fonts.settle();
  await fonts.ready;
  expect(row.scrollLeft).toBe(504);
});
