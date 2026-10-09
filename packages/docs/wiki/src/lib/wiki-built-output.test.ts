import { describe, expect, test } from "vitest";
import { wikiRedirects } from "./wiki-redirects.ts";

const output = new URL("../../dist/", import.meta.url);

async function attributes(
  route: string,
  selector: string,
  name: string,
): Promise<(string | null)[]> {
  const values: (string | null)[] = [];
  // Reading the built artifact is intentional: a missing build must fail.
  const html = await Bun.file(
    new URL(`${route.slice(1)}index.html`, output),
  ).text();
  await new HTMLRewriter()
    .on(selector, {
      element(element) {
        values.push(element.getAttribute(name));
      },
    })
    .transform(new Response(html))
    .text();
  return values;
}

describe("published wiki artifacts", () => {
  test("retains the original legacy route contract", () => {
    expect(wikiRedirects).toMatchObject({
      "/birmel": "/explanation/birmel/",
      "/homelab/releases": "/explanation/homelab/release-safety/",
      "/how-this-wiki-works": "/explanation/how-this-wiki-works/",
      "/pr-fleet-controller": "/explanation/pr-fleet-authority-boundary/",
      "/temporal": "/explanation/temporal/overview/",
      "/temporal/schedules": "/reference/temporal-schedules/",
      "/temporal/workflows": "/reference/temporal-workflows/",
    });
  });

  test("does not mark the home page as unindexable", async () => {
    expect(await attributes("/", 'meta[name="robots"]', "content")).toEqual([]);
  });

  test("includes the workflow reference in the sitemap", async () => {
    expect(await Bun.file(new URL("sitemap-0.xml", output)).text()).toContain(
      "https://wiki.sjer.red/reference/temporal-workflows/",
    );
  });

  test.each(Object.entries(wikiRedirects))(
    "redirects %s to its canonical page",
    async (source, to) => {
      const from = source.endsWith("/") ? source : `${source}/`;
      expect(
        await attributes(from, 'meta[http-equiv="refresh"]', "content"),
      ).toEqual([`0;url=${to}`]);
      expect(await attributes(from, 'link[rel="canonical"]', "href")).toEqual([
        `https://wiki.sjer.red${to}`,
      ]);
      expect(
        await Bun.file(new URL(`${to.slice(1)}index.html`, output)).exists(),
      ).toBe(true);
    },
  );
});
