import { expect, type Page, type Request } from "@playwright/test";
import { PERSONA_COOKIE } from "#testing/fixture-api/server.ts";
import {
  canvasColor,
  computedForm,
  openAs,
  signedOut,
  test,
} from "./support.ts";

/**
 * The installable web app, in a browser: the links in the document, the
 * manifest as Chromium itself fetches and reads it, the icons under the
 * Content-Security-Policy, and the color the browser is told to paint its own
 * chrome. The harness serves all of it with the production client mount
 * (`src/server/static/client.ts`); `web-app.test.ts` beside that module covers
 * the server's side, the session included.
 *
 * The sign-in page is where these start: a browser offers to install Media
 * before anyone has a session.
 */

const MANIFEST = "/manifest.webmanifest";

function origin(): string {
  const base = test.info().project.use.baseURL;
  if (base === undefined)
    throw new Error("The Playwright project has no baseURL");
  return base;
}

async function openSignIn(page: Page) {
  await signedOut(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your next watch.",
  );
}

/** Each `<link>` of the document's head, as `rel type sizes href`. */
async function headLinks(page: Page): Promise<string[]> {
  return page
    .locator("head link:not([rel=stylesheet]):not([rel=modulepreload])")
    .evaluateAll((links) =>
      links.map((link) =>
        ["rel", "type", "sizes", "href"]
          .map((name) => link.getAttribute(name))
          .filter((value) => value !== null)
          .join(" "),
      ),
    );
}

/**
 * Loads an image the way a page shows one, so the policy's `img-src` applies,
 * and reports its pixel size.
 */
async function imageSize(page: Page, source: string): Promise<string> {
  return page.evaluate(async (address) => {
    const image = new globalThis.Image();
    image.src = address;
    await image.decode();
    return `${String(image.naturalWidth)}x${String(image.naturalHeight)}`;
  }, source);
}

/**
 * The `theme-color` the browser paints its chrome with: of the metas whose
 * media query matches the device, the first.
 */
async function chromeColor(page: Page): Promise<string> {
  const content = await page
    .locator('meta[name="theme-color"]')
    .evaluateAll(
      (metas) =>
        metas
          .filter(
            (meta) =>
              globalThis.matchMedia(meta.getAttribute("media") ?? "").matches,
          )
          .map((meta) => meta.getAttribute("content"))[0] ?? null,
    );
  if (content === null) throw new Error("No theme-color matches this device");
  return computedForm(content);
}

test("the sign-in page links the manifest and every icon, and each icon loads", async ({
  page,
}) => {
  await openSignIn(page);
  expect(await headLinks(page)).toEqual([
    `manifest ${MANIFEST}`,
    "icon image/png 32x32 /icons/favicon-32.png",
    "icon image/svg+xml /icons/favicon.svg",
    "apple-touch-icon /icons/apple-touch-icon.png",
  ]);
  expect(await imageSize(page, "/icons/favicon-32.png")).toBe("32x32");
  expect(await imageSize(page, "/icons/apple-touch-icon.png")).toBe("180x180");
  // An SVG with a view box and no size of its own: decoding is the check.
  expect(await imageSize(page, "/icons/favicon.svg")).toMatch(/^\d+x\d+$/u);
});

test("Chromium fetches the manifest without the session and accepts it", async ({
  page,
}) => {
  // A cookie the manifest request could carry, and must not: a browser
  // fetches a manifest without credentials, so it can never need the session.
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: "member", url: origin() }]);
  const session = `${PERSONA_COOKIE}=member`;
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (["/", MANIFEST].includes(new URL(request.url()).pathname)) {
      requests.push(request);
    }
  });
  await openSignIn(page);

  // What DevTools shows under Application > Manifest: the browser's own
  // fetch and parse of the linked manifest, not a script's.
  const devtools = await page.context().newCDPSession(page);
  const manifest = await devtools.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  expect(manifest.url).toBe(`${origin()}${MANIFEST}`);
  // The page itself was fetched with the cookie; the manifest was not.
  const sent = [];
  for (const request of requests) {
    const { cookie = "no cookie" } = await request.allHeaders();
    sent.push(`${new URL(request.url()).pathname} ${cookie}`);
  }
  expect(sent).toEqual([`/ ${session}`, `${MANIFEST} no cookie`]);

  const declared: unknown = JSON.parse(manifest.data ?? "");
  expect(declared).toMatchObject({
    id: "/",
    name: "Media",
    short_name: "Media",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  });
  // `Page.getInstallabilityErrors` is not asked: the headless shell this
  // suite runs has no install surface and answers it with nothing, whatever
  // the manifest holds.

  for (const [source, size] of [
    ["/icons/icon-192.png", "192x192"],
    ["/icons/icon-512.png", "512x512"],
    ["/icons/icon-maskable-512.png", "512x512"],
  ] as const) {
    expect(await imageSize(page, source), source).toBe(size);
  }
});

for (const scheme of ["light", "dark"] as const) {
  const other = scheme === "light" ? "dark" : "light";

  test.describe(`browser chrome on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    test("the sign-in page gives the browser its canvas color", async ({
      page,
    }) => {
      await openSignIn(page);
      expect(await chromeColor(page)).toBe(await canvasColor(page));
    });

    test(`a ${other} theme chosen in the account panel recolors it, and System gives it back`, async ({
      page,
    }) => {
      await openAs(page, "member", "/library");
      const followed = await canvasColor(page);
      expect(await chromeColor(page)).toBe(followed);

      await page.getByRole("button", { name: "Account" }).click();
      const theme = page.getByRole("group", { name: "Theme" });
      await theme.getByText(other === "dark" ? "Dark" : "Light").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      const pinned = await canvasColor(page);
      expect(pinned).not.toBe(followed);
      expect(await chromeColor(page)).toBe(pinned);

      // The choice is applied again before the first render of a reload.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await chromeColor(page)).toBe(pinned);

      await page.getByRole("button", { name: "Account" }).click();
      await theme.getByText("System").click();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      expect(await chromeColor(page)).toBe(followed);
    });
  });
}
