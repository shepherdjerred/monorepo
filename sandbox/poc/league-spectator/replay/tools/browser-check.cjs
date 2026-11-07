const {
  chromium,
} = require("../../../packages/app/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const output = path.resolve(process.argv[2] || ".cache/replay-spike/visuals");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    deviceScaleFactor: 1,
    recordVideo: { dir: output, size: { width: 1600, height: 1050 } },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  try {
    await page.goto("http://127.0.0.1:4180/");
    await page.waitForFunction(
      () => document.querySelector("#loading").style.display === "none",
      null,
      { timeout: 60000 },
    );
    await page
      .getByRole("button", { name: "Open research replay", exact: true })
      .click();
    await page.waitForFunction(() => Boolean(window.replaySpike), null, {
      timeout: 60000,
    });
    const initial = await page.evaluate(() => window.replaySpike.summary());
    assert.equal(initial.packets, 27947);
    const positions = async (t) =>
      page.evaluate((t) => {
        window.replaySpike.seek(t);
        return window.replaySpike.positions();
      }, t);
    const first = await positions(495.25);
    const firstPose = await page.evaluate(() => window.replaySpike.poses());
    await positions(495.5);
    assert.notDeepEqual(
      await page.evaluate(() => window.replaySpike.poses()),
      firstPose,
    );
    await positions(800);
    await positions(120);
    assert.deepEqual(await positions(495.25), first);
    assert.deepEqual(
      await page.evaluate(() => window.replaySpike.poses()),
      firstPose,
    );
    await page
      .getByRole("slider", { name: "Replay time", exact: true })
      .fill("490");
    assert.equal(
      (await page.evaluate(() => window.replaySpike.summary())).time,
      490,
    );
    const paused = await positions(490);
    await page.waitForTimeout(400);
    assert.deepEqual(
      await page.evaluate(() => window.replaySpike.positions()),
      paused,
    );
    await page
      .getByRole("button", { name: "30s activity window", exact: true })
      .click();
    await page.screenshot({ path: path.join(output, "animated-scene.png") });
    await page
      .getByRole("combobox", { name: "Playback speed" })
      .selectOption("4");
    await page
      .getByRole("button", { name: "Play replay", exact: true })
      .click();
    await page.waitForFunction(
      () => !window.replaySpike.summary().playing,
      null,
      { timeout: 30000 },
    );
    const ended = await page.evaluate(() => window.replaySpike.summary());
    assert.equal(ended.time, ended.clipEnd);
    await page.screenshot({ path: path.join(output, "clip-end.png") });
    await page
      .getByRole("button", { name: "Map overview", exact: true })
      .click();
    await page.waitForTimeout(400);
    assert.equal(
      (await page.evaluate(() => window.replaySpike.summary())).follow,
      null,
    );
    await page.screenshot({ path: path.join(output, "map-overview.png") });
    await page.getByRole("button", { name: "Ryze", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.replaySpike.summary())).follow,
      7,
    );
    const canvas = page.locator("#scene"),
      bounds = await canvas.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 80,
      bounds.y + bounds.height / 2 + 40,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.equal(
      (await page.evaluate(() => window.replaySpike.summary())).follow,
      null,
    );
    await page.locator("#file").setInputFiles({
      name: "unsupported.rofl",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("Unsupported replay fixture"),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("Unsupported fixture"),
    );
    assert.equal(await page.evaluate(() => Boolean(window.replaySpike)), false);
    await page
      .getByRole("button", { name: "Open research replay", exact: true })
      .click();
    await page.waitForFunction(() => Boolean(window.replaySpike), null, {
      timeout: 60000,
    });
    assert.equal(await page.locator("#roster button").count(), 10);
    assert.deepEqual(errors, []);
    const result = {
      ...initial,
      checks: [
        "original ROFL loads",
        "reverse seek restores position, facing, clip time and skeletal pose",
        "skeletal pose changes with animation time",
        "pause holds state",
        "slider seeks",
        "4x playback completes 30s window",
        "camera follow and drag",
        "reopen disposes previous scene",
        "unsupported fixture rejected before decoding",
      ],
      browserErrors: errors,
    };
    await fs.writeFile(
      path.join(output, "browser-check.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await page.video().saveAs(path.join(output, "browser-playback.webm"));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
