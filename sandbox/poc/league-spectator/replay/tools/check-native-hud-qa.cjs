const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium, expect } = createRequire(
  path.resolve("packages/scout-for-lol/packages/app/package.json"),
)("@playwright/test");

(async () => {
  const origin = process.argv[2] ?? "http://127.0.0.1:4250";
  if (new URL(origin).hostname !== "127.0.0.1")
    throw Error("Explicit owned loopback HUD QA origin required");
  const output = path.resolve(
    process.argv[3] ?? ".cache/replay-integration/native-hud-qa",
    String(Date.now()),
  );
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    requests = [],
    httpFailures = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    requests.push({ url: request.url(), error: request.failure() }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      httpFailures.push({ url: response.url(), status: response.status() });
  });
  const states = [];
  let result;
  async function inspect(label) {
    const state = await page.evaluate(async () => {
      const canvas = document.querySelector("#hud"),
        pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
      let nontransparent = 0;
      for (let index = 3; index < pixels.length; index += 4)
        if (pixels[index]) nontransparent++;
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return { ...window.__nativeHudQa, nontransparent, pixelSha256: digest };
    });
    expect(state.ready).toBe(true);
    expect(state.drawn.length).toBeGreaterThan(0);
    expect(state.nontransparent).toBeGreaterThan(0);
    states.push({ label, ...state });
    await page
      .locator("#hud")
      .screenshot({ path: path.join(output, `${label}.png`) });
    return state;
  }
  try {
    const response = await page.goto(origin);
    expect(response.status()).toBe(200);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__nativeHudQa?.fontsLoaded ??
              window.__nativeHudQa?.error ??
              null,
          ),
        { timeout: 30000 },
      )
      .toBe(9);
    const first = await inspect("replay-controls-default");
    await page.screenshot({
      path: path.join(output, "static-hud-qa.png"),
      fullPage: true,
    });
    await page.locator("#state").selectOption("HoverStateElements");
    const hover = await inspect("replay-controls-hover");
    expect(hover.pixelSha256).not.toBe(first.pixelSha256);
    await page.locator("#state").selectOption("DefaultStateElements");
    const restored = await inspect("replay-controls-default-restored");
    expect(restored.pixelSha256).toBe(first.pixelSha256);
    await page.locator("#viewport").selectOption("1280×720");
    await inspect("replay-controls-1280");
    await page
      .getByText("Original font specimens · controlled text and sizing", {
        exact: true,
      })
      .click();
    await expect(page.locator("#fonts p")).toHaveCount(9);
    await page
      .locator("#fonts")
      .screenshot({ path: path.join(output, "original-font-specimens.png") });
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(httpFailures).toEqual([]);
    result = { passed: true, states };
  } catch (error) {
    process.exitCode = 1;
    result = { passed: false, error: String(error), states };
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  } finally {
    await page.close();
    await browser.close();
    result = {
      ...result,
      errors,
      requests,
      httpFailures,
      output,
      scope:
        "Rendered original HUD static primitives and source font specimens with explicit QA scene/button state/order; no native controller, sliced/material provider, native blending/text shaping or replay HUD parity claim",
    };
    await fs.writeFile(
      path.join(output, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
