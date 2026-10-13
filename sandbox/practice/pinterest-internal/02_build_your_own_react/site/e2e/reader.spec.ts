import { test, expect } from "@playwright/test";
import { step } from "./helpers.ts";

declare global {
  var savedReaderLine: Element | null;
  var motionSamples: { transform: string; opacity: string }[];
  var readerAnimationReads: number[];
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("retains unchanged DOM lines while scrolling forward and backward", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.goto("./");
  await step(page, 0, 1);
  await page.evaluate(() => {
    globalThis.savedReaderLine =
      [...globalThis.document.querySelectorAll("#wave-0 .code-line")].find(
        (line) => line.textContent.startsWith("const container"),
      ) ?? null;
  });
  await step(page, 0, 2);
  expect(
    await page.evaluate(() => globalThis.savedReaderLine?.isConnected),
  ).toBe(true);
  await step(page, 0, 1);
  expect(
    await page.evaluate(() => globalThis.savedReaderLine?.isConnected),
  ).toBe(true);
  await expect(page.locator("#wave-0 [data-counter]")).toHaveText("2 / 9");
  expect(errors).toEqual([]);
});

test("renders all waves, supports chapter hashes, and stays within the viewport", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("./#step-viii-hooks");
  const chapters = page.getByRole("navigation", { name: "Chapters" });
  await expect(chapters.getByRole("link")).toHaveCount(10);
  await expect(
    chapters.getByRole("link", { name: "State hooks", exact: true }),
  ).toHaveAttribute("href", "#step-viii-hooks");
  await expect(page.locator(".support, .edition-note")).toHaveCount(0);
  await expect(page.locator("#step-viii-hooks")).toBeVisible();
  for (const [wave = 0, index = 0] of [
    [0, 4],
    [1, 9],
    [2, 3],
    [3, 3],
    [4, 18],
    [5, 13],
  ])
    await step(page, wave, index);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const height = await page
    .locator("#wave-5 .sticker")
    .evaluate((element) => element.getBoundingClientRect().height);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("Missing viewport");
  expect(
    Math.abs(
      height - (isMobile ? viewport.height * 0.5 : viewport.height - 64),
    ),
  ).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test("uses Berkeley Mono and measures again after font loading and resize", async ({
  page,
}) => {
  await page.route("**/fonts/*.woff2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.goto("./");
  await step(page, 1, 3);
  expect(
    await page
      .locator(".scene")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Berkeley Mono");
  expect(
    await page.evaluate(() =>
      globalThis.document.fonts.check('13px "Berkeley Mono"'),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 820, height: 900 });
  await step(page, 1, 3);
  const matrix = await page
    .locator("#wave-1 .scene")
    .evaluate((element) => getComputedStyle(element).transform);
  expect(matrix).not.toContain("NaN");
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("keeps long code readable and scrolls instead of shrinking it", async ({
  page,
  isMobile,
}) => {
  await page.goto("./");
  await step(page, 5, 12);
  const scene = page.locator("#wave-5 .scene");
  expect(
    await scene.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await scene.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    ),
  ).toBe(1);
  const viewport = page.locator("#wave-5 .viewport");
  if (!isMobile) {
    await page.mouse.move(1200, 100);
    await expect(viewport).toHaveCSS(
      "scrollbar-color",
      "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)",
    );
    await viewport.hover();
    await expect(viewport).toHaveCSS(
      "scrollbar-color",
      "rgb(101, 104, 97) rgba(0, 0, 0, 0)",
    );
    await page.mouse.move(1200, 100);
    await viewport.focus();
    await expect(viewport).toHaveCSS(
      "scrollbar-color",
      "rgb(101, 104, 97) rgba(0, 0, 0, 0)",
    );
  }
  const before = await viewport.evaluate((element) => ({
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.height);
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await step(page, 5, 13);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollTop + element.clientHeight < element.scrollHeight,
      ),
    )
    .toBe(true);
  await expect(
    page.locator("#wave-5 .code-line").filter({ hasText: "actions.forEach" }),
  ).toBeVisible();
});

test("opens type information with keyboard or tap, clamps it, and dismisses it", async ({
  page,
  isMobile,
}) => {
  await page.goto("./");
  await step(page, 0, 1);
  const token = page
    .locator("#wave-0 .type-token")
    .filter({ hasText: /^element$/ })
    .first();
  if (isMobile) await token.tap();
  else await token.focus();
  const popup = page.locator("#type-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Element");
  const bounds = await popup.boundingBox(),
    viewport = page.viewportSize();
  if (bounds === null || viewport === null)
    throw new Error("Missing popup bounds");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await token.click();
  await expect(popup).toBeVisible();
  await step(page, 0, 2);
  await expect(popup).toBeHidden();
});

test("shows intermediate motion and retargets rapid scrolling", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 0, 1);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    globalThis.motionSamples = [];
    const record = () => {
      const line = [
        ...globalThis.document.querySelectorAll<HTMLElement>(
          "#wave-0 .code-line",
        ),
      ].find((item) => item.textContent.startsWith("const element = <"));
      if (line !== undefined)
        globalThis.motionSamples.push({
          transform: line.style.transform,
          opacity: line.style.opacity,
        });
      if (globalThis.motionSamples.length < 40)
        globalThis.requestAnimationFrame(record);
    };
    globalThis.requestAnimationFrame(record);
    const next = globalThis.document.querySelector("#wave-0-2");
    if (next === null) throw new Error("Missing step");
    const cursor =
      globalThis.innerWidth < 1000
        ? globalThis.innerHeight * 0.72
        : globalThis.innerHeight / 2;
    globalThis.scrollTo({
      top: next.getBoundingClientRect().top + globalThis.scrollY - cursor + 24,
      behavior: "instant",
    });
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        globalThis.motionSamples.some(
          (item) => Number(item.opacity) > 0 && Number(item.opacity) < 0.99,
        ),
      ),
    )
    .toBe(true);
  await step(page, 0, 4);
  await step(page, 0, 1);
  expect(await page.locator("#wave-0 .code-line").count()).toBeLessThan(25);
});

test("virtualizes the full lesson, allows scrolling to its end, and stays idle at rest", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 5, 14);
  const viewport = page.locator("#wave-5 .viewport");
  const budget = await viewport.evaluate(
    (element) =>
      Math.ceil(
        element.clientHeight /
          Number.parseFloat(
            getComputedStyle(element.querySelector(".scene") ?? element)
              .lineHeight,
          ),
      ) + 6,
  );
  expect(await page.locator("#wave-5 .code-line").count()).toBeLessThanOrEqual(
    budget,
  );
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page
      .locator("#wave-5 .code-line")
      .filter({ hasText: "Didact.render(element, container)" }),
  ).toBeVisible();
  expect(await page.locator("#wave-5 .code-line").count()).toBeLessThanOrEqual(
    budget,
  );
  const mutations = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const scene = globalThis.document.querySelector("#wave-5 .scene");
        if (scene === null) throw new Error("Missing scene");
        let count = 0;
        const observer = new globalThis.MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(scene, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
        globalThis.setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 250);
      }),
  );
  expect(mutations).toBe(0);
});

test("animates without repeatedly reading computed styles", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 5, 12);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    globalThis.readerAnimationReads = [];
    const raf = globalThis.requestAnimationFrame;
    const styles = globalThis.getComputedStyle;
    let styleReads = 0;
    globalThis.getComputedStyle = function (element, pseudo) {
      styleReads++;
      return styles.call(globalThis, element, pseudo);
    };
    globalThis.requestAnimationFrame = (callback) =>
      raf.call(globalThis, (time) => {
        styleReads = 0;
        callback(time);
        globalThis.readerAnimationReads.push(styleReads);
      });
  });
  await step(page, 5, 13);
  await expect(page.locator("#wave-5 .scene")).not.toHaveClass(/animating/, {
    timeout: 10_000,
  });
  const samples = await page.evaluate(() => globalThis.readerAnimationReads);
  expect(samples.length).toBeGreaterThan(10);
  expect(samples.slice(-10).every((reads) => reads === 0)).toBe(true);
});

test("crossfades loaded fiber illustrations with at most two layers", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 3, 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await step(page, 3, 1);
  const images = page.locator("#wave-3 .scene img");
  await expect
    .poll(() =>
      images.evaluateAll(
        (elements) =>
          elements.length === 2 &&
          elements.every(
            (element) =>
              element instanceof globalThis.HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 0 &&
              Number(element.style.opacity) > 0 &&
              Number(element.style.opacity) < 1,
          ),
      ),
    )
    .toBe(true);
  await expect(page.locator("#wave-3 .scene")).not.toHaveClass(/animating/, {
    timeout: 10_000,
  });
  await expect(images).toHaveCount(1);
});

test("bounds and centers illustrations on large screens and after resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("./");
  await step(page, 3, 1);
  for (const size of [
    { width: 2560, height: 1440 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await step(page, 3, 1);
    const scene = await page.locator("#wave-3 .scene").boundingBox();
    const viewport = await page.locator("#wave-3 .viewport").boundingBox();
    if (scene === null || viewport === null)
      throw new Error("Missing illustration bounds");
    expect(scene.width).toBeLessThanOrEqual(560);
    expect(scene.height).toBeLessThanOrEqual(640);
    expect(scene.width).toBeLessThanOrEqual(viewport.width);
    expect(scene.height).toBeLessThanOrEqual(viewport.height);
    expect(
      Math.abs(scene.x + scene.width / 2 - viewport.x - viewport.width / 2),
    ).toBeLessThan(1);
    expect(
      Math.abs(scene.y + scene.height / 2 - viewport.y - viewport.height / 2),
    ).toBeLessThan(1);
  }
});

test.describe("rapid scrolling at Retina resolution", () => {
  test.use({ deviceScaleFactor: 2 });

  test("keeps the background painted during rapid scrolling", async ({
    page,
    isMobile,
  }) => {
    if (!isMobile) await page.setViewportSize({ width: 2048, height: 1055 });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("./");
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i < 6 ? 6000 : -6000);
      // Capture the next rendered frame, rather than the surface before the wheel is presented.
      await page.evaluate(() => new Promise(globalThis.requestAnimationFrame));
      const screenshot = await page.screenshot({ scale: "css" });
      const colors = await page.evaluate(async (base64) => {
        const response = await globalThis.fetch(
          `data:image/png;base64,${base64}`,
        );
        const image = await globalThis.createImageBitmap(await response.blob());
        const canvas = new globalThis.OffscreenCanvas(
          image.width,
          image.height,
        );
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Missing screenshot canvas");
        context.drawImage(image, 0, 0);
        const y = Math.floor(image.height / 2);
        const pixels = [2, image.width - 3].map((x) =>
          [...context.getImageData(x, y, 1, 1).data].slice(0, 3),
        );
        image.close();
        return pixels;
      }, screenshot.toString("base64"));
      if (isMobile) {
        for (const color of colors)
          expect([
            [32, 34, 38],
            [250, 249, 245],
          ]).toContainEqual(color);
      } else {
        expect(colors).toEqual([
          [32, 34, 38],
          [250, 249, 245],
        ]);
        const panel = await page.locator(".page-background").boundingBox();
        expect(panel).toEqual({ x: 1024, y: 0, width: 1024, height: 1055 });
      }
    }
    await session.detach();
  });
});

test("article and full code remain readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4327/build-your-own-react/");
  await expect(page.locator("h1")).toHaveText("Build your own React");
  const code = page.locator(".fallback").first();
  await code.locator("summary").click();
  await expect(code.locator("pre")).toContainText(
    'const element = <h1 title="foo">Hello</h1>',
  );
  await expect(page.locator("#step-viii-hooks")).toBeAttached();
  await expect(page.locator(".progress-track").first()).toBeHidden();
  await expect(page.locator("#wave-3 .fallback img")).toHaveCount(5);
  await context.close();
});
