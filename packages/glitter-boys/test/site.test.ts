import { readFile, stat } from "node:fs/promises";
import { expect, test } from "vitest";

const packageRoot = new URL("../", import.meta.url);
const output = new URL("dist/", packageRoot);
const gameRoutes = ["docs/iw4", "docs/t4", "docs/t5", "docs/t6", "docs/t7"];
const crossplayRoutes = [
  "docs/crossplay",
  "docs/crossplay/windows",
  "docs/crossplay/windows/bo3",
  "docs/crossplay/macos",
  "docs/crossplay/play-together",
];
const routes = ["docs", "docs/launcher", ...crossplayRoutes, ...gameRoutes];

test("the homepage stays separate from the docs", async () => {
  const html = await readFile(new URL("index.html", output), "utf8");
  expect(html).toMatch(/<h1[^>]*aria-label="Glitter Boys"/u);
  expect(html).not.toMatch(/href=["']\/docs\//u);
  expect(html).not.toContain("starlight");
  expect(html).toContain('aria-hidden="true"');
});

test("every guide builds as its own document with working docs navigation", async () => {
  for (const route of routes) {
    const html = await readFile(new URL(route + "/index.html", output), "utf8");
    expect(html).toContain("Glitter Boys");
    for (const target of routes) {
      expect(html).toContain('href="/' + target + '/"');
    }
    expect(html).not.toContain("Boii_Bypass_Checks");
  }
});

test("search, sitemap, and the 404 page are included", async () => {
  expect(
    (await stat(new URL("pagefind/pagefind.js", output))).size,
  ).toBeGreaterThan(0);
  const sitemap = await readFile(new URL("sitemap-0.xml", output), "utf8");
  for (const route of routes) {
    expect(sitemap).toContain("https://glitter-boys.com/" + route + "/");
  }
  expect(await readFile(new URL("404.html", output), "utf8")).toMatch(
    /not found/iu,
  );
});

test("every game guide has responsive screenshots with existing full-size assets", async () => {
  for (const route of gameRoutes) {
    const html = await readFile(new URL(route + "/index.html", output), "utf8");
    const figures = [
      ...html.matchAll(
        /<figure\b[^>]*class="guide-screenshot[^>]*>[\s\S]*?<\/figure>/gu,
      ),
    ];
    expect(figures.length, route).toBeGreaterThanOrEqual(2);
    for (const [figure] of figures) {
      expect(figure).toMatch(/<img\b[^>]*alt="[^"]+"/u);
      expect(figure).toContain("srcset=");
      expect(figure).toContain("<figcaption");
      expect(figure).toContain("Source:");
      const fullSize = /href="(\/_astro\/[^"]+)"/u.exec(figure)?.[1];
      expect(fullSize, route).toBeDefined();
      const asset = new URL("." + fullSize!, output);
      expect((await stat(asset)).size).toBeGreaterThan(0);
    }
  }
});
