const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { chromium, expect } = createRequire(
  path.resolve("packages/scout-for-lol/packages/app/package.json"),
)("@playwright/test");

(async () => {
  const origin = process.argv[2] ?? "http://127.0.0.1:4188";
  if (new URL(origin).hostname !== "127.0.0.1")
    throw Error("Owned loopback Scout demo required");
  const output = path.resolve(
    process.argv[3] ?? ".cache/replay-integration/native-replay-controls",
    String(Date.now()),
  );
  await fs.mkdir(output, { recursive: true });
  const sites = await fs.readFile(
      "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
      "utf8",
    ),
    csp = Array.from(
      sites
        .match(/const scoutCsp = \[([\s\S]*?)\]\.join/)[1]
        .matchAll(/"([^"]+)"/g),
      (row) => row[1],
    ).join("; "),
    browser = await chromium.launch({ channel: "msedge", headless: true }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      colorScheme: "dark",
    });
  await context.route(`${origin}/**`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  const sourceReads = [],
    sourceHashes = new Map();
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const page = await context.newPage(),
    errors = [],
    failures = [],
    httpFailures = [],
    steps = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failures.push({ url: request.url(), failure: request.failure() }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      httpFailures.push({ url: response.url(), status: response.status() });
    const url = new URL(response.url());
    if (
      url.origin === new URL(origin).origin &&
      (/\.(?:mjs|js|css)$/.test(url.pathname) ||
        url.pathname === "/demo/native-controls.json")
    )
      sourceReads.push(
        response
          .body()
          .then((bytes) => sourceHashes.set(response.url(), hash(bytes))),
      );
  });
  let result;
  const action = (name) =>
    page.locator(`[data-native-replay-action="${name}"]`);
  async function healthy() {
    if (await page.getByRole("alert").count())
      throw Error(await page.getByRole("alert").innerText());
  }
  try {
    expect((await page.goto(origin)).status()).toBe(200);
    await expect
      .poll(
        async () =>
          (await action("Play")
            .getAttribute("aria-label")
            .catch(() => null)) ??
          ((await page.getByRole("alert").count()) ? "fatal" : null),
        { timeout: 180000 },
      )
      .toBe("Play");
    await healthy();
    await expect(page.locator(".native-replay-controls output")).toHaveText(
      "1X",
    );
    await action("Play").focus();
    await page.keyboard.press("Space");
    await expect(action("Play")).toHaveAttribute("aria-label", "Pause");
    await page.keyboard.press("Enter");
    await expect(action("Play")).toHaveAttribute("aria-label", "Play");
    steps.push(
      "Native HTML Space/Enter each activate once through the shared session",
    );
    await action("SpeedUp").click();
    await expect(page.locator(".native-replay-controls output")).toHaveText(
      "2X",
    );
    await action("SpeedUp").click();
    await expect(page.locator(".native-replay-controls output")).toHaveText(
      "4X",
    );
    await expect(action("SpeedUp")).toHaveAttribute("aria-disabled", "true");
    await action("SpeedUp").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".native-replay-controls output")).toHaveText(
      "4X",
    );
    for (const label of ["2X", "1X", ".5X"]) {
      await action("SpeedDown").click();
      await expect(page.locator(".native-replay-controls output")).toHaveText(
        label,
      );
    }
    await expect(action("SpeedDown")).toHaveAttribute("aria-disabled", "true");
    steps.push(
      "Original rate labels/steps respect actual partial-engine capabilities",
    );
    const slider = page.getByLabel("Replay time");
    await slider.fill("79.8");
    await slider.dispatchEvent("change");
    await expect
      .poll(
        async () => {
          await healthy();
          return slider.getAttribute("aria-busy");
        },
        { timeout: 60000 },
      )
      .toBe("false");
    await action("SkipBack").click();
    await expect
      .poll(
        async () => {
          await healthy();
          return Number(await slider.inputValue());
        },
        { timeout: 60000 },
      )
      .toBeCloseTo(64.80000305175781, 4);
    steps.push(
      "Original -15f clock/clamp action rendered through actual session seek",
    );
    const bridge = page.locator(".native-replay-controls");
    await bridge.screenshot({ path: path.join(output, "native-controls.png") });
    await page.screenshot({
      path: path.join(output, "shared-player-native-controls.png"),
      fullPage: true,
    });
    const beforeResize = await page.evaluate(() =>
      window.__scoutReplayResearch.presentations(),
    );
    await page.evaluate(() =>
      window.__scoutReplayResearch.startPerformanceRecording(),
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await expect
      .poll(
        () => page.evaluate(() => window.__scoutReplayResearch.presentations()),
        { timeout: 30000 },
      )
      .toBeGreaterThan(beforeResize);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const resized = await page.evaluate(() =>
      window.__scoutReplayResearch.stopPerformanceRecording(),
    );
    expect(resized.frames.length).toBeGreaterThan(0);
    expect(resized.frames.every((frame) => frame.playing === false)).toBe(true);
    expect(resized.frames.at(-1).width).toBeLessThan(500);
    await expect(action("Play")).toHaveAttribute("aria-label", "Play");
    await expect
      .poll(async () => Number(await slider.inputValue()))
      .toBeCloseTo(64.80000305175781, 4);
    await fs.writeFile(
      path.join(output, "paused-resize.json"),
      JSON.stringify(resized, null, 2),
    );
    steps.push(
      "Paused scene re-presented after same-aspect resize without advancing replay time",
    );
    const mobileDom = await page.evaluate(() => ({
      scrollY,
      height: document.documentElement.scrollHeight,
      regions: [
        document.querySelector("header"),
        document.querySelector(".native-replay-controls"),
      ].map((element) => {
        const style = getComputedStyle(element),
          bounds = element.getBoundingClientRect();
        return {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        };
      }),
    }));
    await page.screenshot({
      path: path.join(output, "shared-player-native-controls-mobile.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(
        output,
        "shared-player-native-controls-mobile-viewport.png",
      ),
    });
    await page
      .locator("header")
      .screenshot({ path: path.join(output, "mobile-header.png") });
    await bridge.screenshot({
      path: path.join(output, "mobile-native-controls.png"),
    });
    const geometry = await action("Play").evaluate((button) => {
      const rect = button.getBoundingClientRect(),
        canvas = button.parentElement.querySelector("canvas"),
        pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4)
        if (pixels[index]) visible++;
      return {
        width: rect.width,
        height: rect.height,
        coarse: matchMedia("(pointer: coarse)").matches,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        visiblePixels: visible,
      };
    });
    expect(geometry.visiblePixels).toBeGreaterThan(0);
    expect(geometry.width).toBeGreaterThanOrEqual(geometry.coarse ? 44 : 24);
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.coarse ? 44 : 24);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await healthy();
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    expect(httpFailures).toEqual([]);
    result = { passed: true, steps, geometry, mobileDom };
  } catch (error) {
    process.exitCode = 1;
    result = { passed: false, error: String(error), steps };
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  } finally {
    await Promise.all(sourceReads);
    const sourceDrift = [];
    for (const [url, expected] of sourceHashes) {
      const response = await fetch(url);
      if (
        response.status !== 200 ||
        hash(Buffer.from(await response.arrayBuffer())) !== expected
      )
        sourceDrift.push(url);
    }
    if (sourceDrift.length) {
      process.exitCode = 1;
      result = {
        ...result,
        passed: false,
        error: "Served control source changed during browser verification",
      };
    }
    await context.close();
    await browser.close();
    result = {
      ...result,
      errors,
      failures,
      httpFailures,
      sourceHashes: Object.fromEntries(sourceHashes),
      sourceDrift,
      output,
      scope:
        "Actual Scout shared-player SDK and original authored control art/state/rate outputs; browser owns input/accessibility. Native event-service process admission, full HUD text/visibility and native fidelity remain separate.",
    };
    await fs.writeFile(
      path.join(output, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        ...result,
        sourceHashes: undefined,
        sourceFiles: sourceHashes.size,
      }),
    );
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
