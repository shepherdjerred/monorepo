import { expect, test } from "@playwright/test";
import {
  installRecordedDrawProbe,
  readRecordedDraw,
} from "#replay-e2e/recorded-draw-probe.ts";
import {
  contentPath,
  readRecordedReplay,
  replayPath,
  sha256,
} from "#replay-e2e/recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  seek,
} from "#replay-e2e/recorded-replay-fixture.ts";

const mayhemReplaySha256 =
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7";

test("signed-out Bloom replay plays the opening fight at 1× and restores a share", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  expect(fixture.descriptor).toMatchObject({
    mapId: 12,
    gameMode: "KIWI",
    sha256: mayhemReplaySha256,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedDrawProbe(page);
  const response = await page.goto(replayPath);
  expect(response?.ok()).toBe(true);

  const play = page.getByRole("button", { name: "Play", exact: true });
  const canvas = page.getByLabel("League of Legends replay scene");
  const slider = page.getByRole("slider", { name: "Replay time" });
  const camera = page.getByRole("combobox", { name: "Camera" });
  await expect(play).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Speed" })).toHaveValue("1");
  await seek(page, 60);
  await expect(camera.getByRole("option")).toHaveCount(11);
  const opening = await readRecordedDraw(page);
  expect(opening.texturedIndices).toBeGreaterThan(0);
  expect(
    new Set(opening.actorOrigins.map((origin) => origin.join(","))).size,
  ).toBe(10);
  const openingPixels = sha256(
    await canvas.screenshot({
      path: testInfo.outputPath("bloom-opening-fight.png"),
    }),
  );
  await play.click();
  await expect
    .poll(async () => Number(await slider.inputValue()), {
      timeout: 45_000,
    })
    .toBeGreaterThanOrEqual(90);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    sha256(
      await canvas.screenshot({
        path: testInfo.outputPath("bloom-after-fight.png"),
      }),
    ),
  ).not.toBe(openingPixels);
  await seek(page, 60);
  expect(await readRecordedDraw(page)).toMatchObject({
    actorOrigins: opening.actorOrigins,
  });
  expect(traffic.requested).toContain(contentPath);
  expect(traffic.requested).toContain(fixture.packageUrl);
  expect(traffic.credentialed.size).toBe(0);
  expect(errors).toEqual([]);

  const shared = await browser.newPage();
  try {
    const share = new URL(replayPath, baseURL);
    share.search = new URLSearchParams({
      t: "75",
      follow: "1073741892",
    }).toString();
    const sharedResponse = await shared.goto(share.href);
    expect(sharedResponse?.ok()).toBe(true);
    await expect(
      shared.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await expect(
      shared.getByRole("slider", { name: "Replay time" }),
    ).toHaveValue("75");
    await expect(shared.getByRole("combobox", { name: "Camera" })).toHaveValue(
      "player:1073741892",
    );
  } finally {
    await shared.close();
  }
});
